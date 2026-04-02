import {
  Injectable,
  UnauthorizedException,
  Logger,
  InternalServerErrorException,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import { Request, Response, CookieOptions } from 'express';
import { LoginDto } from './dto/login.dto';

// Umbral independiente del throttle por IP para resistir fuerza bruta distribuida desde múltiples IPs
const ACCOUNT_LOCKOUT_MAX_ATTEMPTS = 10;
const ACCOUNT_LOCKOUT_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private privateKey: string;
  private publicKey: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    try {
      const envPrivateKey = this.normalizePem(this.configService.get<string>('JWT_PRIVATE_KEY'));
      const envPublicKey = this.normalizePem(this.configService.get<string>('JWT_PUBLIC_KEY'));
      const privatePath = this.configService.get<string>('JWT_PRIVATE_KEY_PATH');
      const publicPath = this.configService.get<string>('JWT_PUBLIC_KEY_PATH');

      this.privateKey = envPrivateKey || (privatePath ? fs.readFileSync(privatePath, 'utf8') : '');
      this.publicKey = envPublicKey || (publicPath ? fs.readFileSync(publicPath, 'utf8') : '');

      if (!this.privateKey || !this.publicKey) {
        throw new Error('Missing JWT key material');
      }
    } catch {
      this.logger.error('CRÍTICO: No se pudieron cargar las claves JWT');
      throw new InternalServerErrorException('Error de configuración del servidor');
    }
  }

  // Permite cargar PEM desde variables de entorno en contenedores:
  // 1) clave literal multilínea, 2) clave con \n escapado, 3) PEM codificado en base64
  private normalizePem(value?: string): string {
    if (!value) return '';
    const trimmed = value.trim();

    if (trimmed.includes('BEGIN')) {
      return trimmed.replace(/\\n/g, '\n');
    }

    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
      if (decoded.includes('BEGIN')) return decoded;
    } catch {
      return '';
    }

    return '';
  }

  // Los primeros 8 chars del SHA-256 bastan para correlacionar eventos del mismo usuario
  // sin guardar el email en texto claro en los sistemas de logging
  private maskEmail(email: string): string {
    return createHash('sha256').update(email).digest('hex').slice(0, 8) + '…';
  }

  private logSecurityEvent(event: string, meta: Record<string, unknown>) {
    this.logger.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...meta }));
  }

  // La clave nunca contiene el email en claro — solo su hash — para no filtrarlo en el almacén de caché
  private failCacheKey(email: string): string {
    return `login_fails:${createHash('sha256').update(email).digest('hex')}`;
  }

  private async recordLoginFailure(email: string): Promise<void> {
    const key = this.failCacheKey(email);
    const current = (await this.cacheManager.get<number>(key)) ?? 0;
    await this.cacheManager.set(key, current + 1, ACCOUNT_LOCKOUT_TTL_MS);
  }

  private async clearLoginFailures(email: string): Promise<void> {
    await this.cacheManager.del(this.failCacheKey(email));
  }

  private async isAccountLocked(email: string): Promise<boolean> {
    const fails = (await this.cacheManager.get<number>(this.failCacheKey(email))) ?? 0;
    return fails >= ACCOUNT_LOCKOUT_MAX_ATTEMPTS;
  }

  async login(loginDto: LoginDto, req: Request, res: Response) {
    const ip = req.ip;
    const userAgent = req.headers['user-agent'] || 'desconocido';
    const emailMask = this.maskEmail(loginDto.email);

    // Se verifica antes de tocar la BD — una cuenta bloqueada se rechaza de inmediato sin importar la IP
    if (await this.isAccountLocked(loginDto.email)) {
      this.logSecurityEvent('AUTH_ACCOUNT_LOCKED', { emailMask, ip });
      throw new HttpException(
        'Cuenta bloqueada temporalmente por demasiados intentos fallidos',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.usersService.findByEmail(loginDto.email);

    // bcrypt.compare corre siempre, aunque el usuario no exista, para que el tiempo de respuesta
    // sea idéntico en ambos casos y un atacante no pueda distinguir si el email está registrado
    const dummyHash = '$2b$12$invalidhashfortimingpurposesonly000000000000000000000';
    const passwordValid = user
      ? await bcrypt.compare(loginDto.password, user.password_hash)
      : await bcrypt.compare(loginDto.password, dummyHash).then(() => false);

    if (!user || !passwordValid) {
      await this.recordLoginFailure(loginDto.email);
      this.logSecurityEvent('AUTH_LOGIN_FAILURE', { emailMask, ip, userAgent });
      // El mensaje es idéntico tanto si el email no existe como si la contraseña es incorrecta
      throw new UnauthorizedException('Credenciales inválidas');
    }

    await this.clearLoginFailures(loginDto.email);
    const { accessToken, refreshToken, jti } = await this.generateTokens(user.id);
    await this.usersService.updateRefreshTokenHash(user.id, jti);

    // no-store evita que proxies o el navegador almacenen en caché la respuesta de autenticación
    res.setHeader('Cache-Control', 'no-store');
    this.setCookies(res, accessToken, refreshToken, req);
    this.logSecurityEvent('AUTH_LOGIN_SUCCESS', { userId: user.id, ip, userAgent });
    return { success: true, message: 'Sesión iniciada correctamente' };
  }

  async refresh(req: Request, res: Response) {
    const refreshTokenReq = req.cookies['refresh_token'];
    if (!refreshTokenReq) throw new UnauthorizedException('Falta el refresh token');

    // verifyAsync comprueba la firma RS256 — un token forjado o alterado falla aquí.
    // El userId se lee del payload ya verificado, así que no hace falta el access_token.
    // Antes se usaba jwtService.decode() (sin verificar firma), lo que permitía a alguien
    // con solo el refresh_token fabricar el sub del access_token y robar la sesión.
    let payload: { sub: string; jti: string; type: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshTokenReq, {
        publicKey: this.publicKey,
        algorithms: ['RS256'],
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido');
    }

    // El claim type impide usar un access_token válido como refresh_token (confusión de tokens)
    if (payload.type !== 'refresh' || !payload.jti || !payload.sub) {
      throw new UnauthorizedException('Claims del token inválidos');
    }

    const { accessToken, refreshToken, jti: newJti } = await this.generateTokens(payload.sub);

    // Rotación atómica con SELECT FOR UPDATE — si dos peticiones llegan con el mismo token,
    // solo uno gana; el segundo encuentra el hash ya cambiado y devuelve false
    const rotated = await this.usersService.atomicRotateRefreshToken(payload.sub, payload.jti, newJti);

    if (!rotated) {
      // Se usó un token ya consumido — posible robo, se invalidan todas las sesiones del usuario
      await this.usersService.updateRefreshTokenHash(payload.sub, null);
      this.logSecurityEvent('AUTH_REFRESH_ATTACK', { userId: payload.sub, ip: req.ip });
      throw new UnauthorizedException('Refresh token inválido');
    }

    res.setHeader('Cache-Control', 'no-store');
    this.setCookies(res, accessToken, refreshToken, req);
    this.logSecurityEvent('AUTH_REFRESH', { userId: payload.sub, ip: req.ip });
    return { success: true, message: 'Tokens renovados' };
  }

  async logout(userId: string, req: Request, res: Response) {
    await this.usersService.updateRefreshTokenHash(userId, null);
    const cookieOptions = this.buildCookieOptions(req);
    // clearCookie necesita los mismos atributos con los que se creó la cookie, si no el navegador la ignora
    res.clearCookie('access_token', cookieOptions);
    res.clearCookie('refresh_token', cookieOptions);
    res.setHeader('Cache-Control', 'no-store');
    this.logSecurityEvent('AUTH_LOGOUT', { userId, ip: req.ip });
    return { success: true };
  }

  private async generateTokens(userId: string) {
    const jti = randomUUID();

    const accessToken = this.jwtService.sign(
      { sub: userId },
      { algorithm: 'RS256', privateKey: this.privateKey, expiresIn: this.configService.get('JWT_ACCESS_EXPIRES_IN') },
    );

    // El refresh token es un JWT firmado en lugar de un UUID opaco para que:
    // - el sub (userId) se pueda leer tras verificar la firma, sin depender del access_token caducado
    // - el exp fuerce una expiración real aunque la cookie siga viva en el navegador
    // - el jti (UUID) sea lo que se hashea en BD — con 36 chars siempre entra en el límite de bcrypt (72 bytes)
    // - el claim type bloquee la confusión de tokens: ningún access_token puede usarse como refresh_token
    const refreshToken = this.jwtService.sign(
      { sub: userId, jti, type: 'refresh' },
      { algorithm: 'RS256', privateKey: this.privateKey, expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN') },
    );

    return { accessToken, refreshToken, jti };
  }

  // Detecta HTTPS tanto en conexiones directas como detrás de un proxy inverso
  // (Nginx, Caddy, AWS ALB) que termina TLS y reenvía al servidor por HTTP interno
  private isSecureContext(req: Request): boolean {
    return (
      req.secure ||
      req.headers['x-forwarded-proto'] === 'https' ||
      this.configService.get('NODE_ENV') === 'production'
    );
  }

  private setCookies(res: Response, accessToken: string, refreshToken: string, req: Request) {
    const base = this.buildCookieOptions(req);
    // httpOnly impide que JS acceda a la cookie — mitiga el robo de tokens via XSS
    // En producción cross-site requiere SameSite=None y Secure=true para que el navegador envíe cookies.
    res.cookie('access_token', accessToken, { ...base, maxAge: 15 * 60 * 1000 });
    res.cookie('refresh_token', refreshToken, { ...base, maxAge: 7 * 24 * 60 * 60 * 1000 });
  }

  private buildCookieOptions(req: Request): CookieOptions {
    const secure = this.isSecureContext(req);
    const sameSite: 'none' | 'lax' = secure ? 'none' : 'lax';
    return { httpOnly: true, secure, sameSite, path: '/' as const };
  }
}

import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as fs from 'fs';

declare global {
  namespace Express {
    interface Request { user?: any; }
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private publicKey: string;

  constructor(private readonly jwtService: JwtService, private readonly configService: ConfigService) {
    const keyPath = this.configService.get<string>('JWT_PUBLIC_KEY_PATH');
    if (keyPath) this.publicKey = fs.readFileSync(keyPath, 'utf8');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    // El token viene de una cookie HttpOnly  nunca del header Authorization ni de query params
    const token = request.cookies['access_token'];
    if (!token) throw new UnauthorizedException('Token de autenticación no encontrado');

    try {
      // algorithms: ['RS256'] rechaza explícitamente cualquier otro algoritmo para evitar
      // ataques de confusión donde el atacante pone alg=HS256 y firma con la clave pública
      const payload = await this.jwtService.verifyAsync(token, {
        publicKey: this.publicKey,
        algorithms: ['RS256'],
      });
      request.user = payload;
    } catch {
      throw new UnauthorizedException('Token inválido o caducado');
    }
    return true;
  }
}

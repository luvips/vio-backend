import { Injectable, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from '../auth/dto/register.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  async createUser(registerDto: RegisterDto): Promise<User> {
    try {
      // Factor 12 — lo bastante lento para que un ataque offline sea inviable, sin saturar el servidor
      const password_hash = await bcrypt.hash(registerDto.password, 12);
      const newUser = this.userRepository.create({ email: registerDto.email, password_hash });
      return await this.userRepository.save(newUser);
    } catch (error: any) {
      if (error.code === '23505') throw new ConflictException('El email ya está registrado');
      throw new InternalServerErrorException();
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async updateRefreshTokenHash(userId: string, jti: string | null): Promise<void> {
    // jti es el UUID del JWT de refresh (36 chars) — siempre dentro del límite de 72 bytes de bcrypt
    const hash = jti ? await bcrypt.hash(jti, 10) : null;
    await this.userRepository.update(userId, { refresh_token_hash: hash });
  }

  // SELECT FOR UPDATE bloquea la fila durante toda la transacción.
  // Sin esto, dos peticiones concurrentes con el mismo refresh token pasan ambos el bcrypt.compare
  // antes de que ninguno actualice el hash, generando dos sesiones válidas desde el mismo token (TOCTOU).
  async atomicRotateRefreshToken(userId: string, oldJti: string, newJti: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!user || !user.refresh_token_hash) return false;

      const isValid = await bcrypt.compare(oldJti, user.refresh_token_hash);
      if (!isValid) return false;

      await manager.update(User, userId, { refresh_token_hash: await bcrypt.hash(newJti, 10) });
      return true;
    });
  }
}

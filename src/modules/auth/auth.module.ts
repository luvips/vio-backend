import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CacheModule } from '@nestjs/cache-manager';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Module({
  imports: [
    UsersModule,
    // El JWT Service base. Nosotros lo securizamos limitando los algoritmos directos
    // en los métodos verifyAsync() y sign(), por lo que aquí no configuramos
    // secreto global para prevenir usos erróneos en otros lados.
    JwtModule.register({}),
    // CacheModule necesario para el contador de fallos de login por cuenta (bloqueo por fuerza bruta)
    CacheModule.register(),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtModule, JwtAuthGuard],
})
export class AuthModule {}

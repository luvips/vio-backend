import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { envValidationSchema } from './config/env.validation';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { MoviesModule } from './modules/movies/movies.module';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  imports: [
    // La app rechaza arrancar si falta alguna variable de entorno requerida — falla rápido antes que en silencio
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: true },
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbUrl = configService.get<string>('DATABASE_URL') || '';
        const useSSL = dbUrl.includes('supabase') || configService.get('NODE_ENV') === 'production';
        return {
          type: 'postgres' as const,
          url: dbUrl,
          autoLoadEntities: true,
          synchronize: false, // nunca en producción — podría eliminar columnas al cambiar el schema
          logging: configService.get('NODE_ENV') === 'development',
          ssl: useSSL ? { rejectUnauthorized: false } : false,
        };
      },
    }),

    // Límite global: 100 peticiones / 15 min por IP — protección base contra DDoS y scraping
    ThrottlerModule.forRoot([{ ttl: 15 * 60 * 1000, limit: 100 }]),

    UsersModule,
    AuthModule,
    MoviesModule,
  ],
  providers: [
    // Aplicado globalmente — los endpoints de auth agregan un @Throttle más estricto encima
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}

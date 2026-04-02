import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Agrega headers de seguridad: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.
  app.use(helmet());

  // CORS restringido por lista explícita + soporte para previews de Vercel.
  // Se normaliza para evitar errores por espacios o slash final en ALLOWED_ORIGINS.
  const allowedOrigins = (process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'])
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      // Permite herramientas sin Origin (curl, health checks del servidor, etc.)
      if (!origin) return callback(null, true);

      const normalized = origin.replace(/\/$/, '');
      const isAllowed =
        allowedOrigins.includes(normalized) ||
        /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(normalized);

      return callback(isAllowed ? null : new Error('Origen no permitido por CORS'), isAllowed);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,              // elimina propiedades no declaradas — evita asignación masiva
    forbidNonWhitelisted: true,   // rechaza la petición si llegan campos no esperados, en lugar de ignorarlos
    transform: true,
    disableErrorMessages: process.env.NODE_ENV === 'production', // en producción no se detallan los errores de validación
  }));

  // Normaliza todos los errores — el stack trace nunca llega al cliente
  app.useGlobalFilters(new HttpExceptionFilter());

  // Activa @Exclude() en las entidades (password_hash, refresh_token_hash) para todas las respuestas
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  await app.listen(process.env.PORT || 3000);
}
bootstrap();

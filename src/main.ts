import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Agrega headers de seguridad: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.
  app.use(helmet());

  // CORS restringido a los orígenes del env — nunca wildcard; credentials: true es necesario para las cookies HttpOnly
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
  app.enableCors({ origin: allowedOrigins, credentials: true, methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH'] });

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

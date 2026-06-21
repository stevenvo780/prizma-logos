import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { captureRawBody } from './middleware-nest/raw-body.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });

  // IMPORTANTE: Registrar el middleware de captura de raw body ANTES de cualquier parser JSON.
  // Este middleware permite que verifySignature() acceda al body raw (no JSON.stringify)
  // para validar la firma HMAC del webhook desde Nous.
  app.use(express.json({ verify: captureRawBody }));

  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:8080'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'x-email',
      'x-api-key',
      'x-hub-signature',
      'Partner-Id',
    ],
  });

  // Global API prefix, but keep the Prizma-standard health probe at bare `/health`
  // (ARCHITECTURE.md §3 service registry expects healthPath "/health").
  app.setGlobalPrefix('api', { exclude: ['health'] });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: false,
    forbidUnknownValues: false,
    transform: true,
    validateCustomDecorators: true,
  }));

  const PORT = Number(process.env.PORT) || 8080;
  await app.listen(PORT);
  console.log(`Logos is running on port ${PORT}`);
}

bootstrap().catch(() => {
  process.exit(1);
});

export {};

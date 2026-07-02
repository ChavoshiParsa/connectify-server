import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { MAX_MESSAGE_IMAGE_BYTES } from './message-media/message-media.constants';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { NODE_ENV } from './env';
import { NestPinoLogger } from './logger/nest-pino.service';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      trustProxy: true,
    }),
    { bufferLogs: true },
  );

  const logger = app.get(NestPinoLogger);
  app.useLogger(logger);

  const configService = app.get(ConfigService);

  await app.register(fastifyCookie, {
    secret: configService.get<string>('COOKIE_SECRET') || configService.get<string>('JWT_REFRESH_SECRET'),
    hook: 'onRequest',
  });

  await app.register(fastifyMultipart, {
    limits: {
      files: 1,
      fileSize: MAX_MESSAGE_IMAGE_BYTES,
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
      validateCustomDecorators: true,
    }),
  );

  const allowedOrigins =
    configService
      .get<string>('ALLOWED_ORIGINS')
      ?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) || [];

  app.enableCors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    credentials: true,
  });

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = configService.get<number>('PORT') || 3001;
  const host = configService.get<string>('HOST') || '0.0.0.0';

  await app.listen(port, host);

  logger.log(`Server is live and listening on ${host}:${port} (${NODE_ENV})`, 'Bootstrap');
}

bootstrap().catch((error) => {
  // Use console here because Nest may not be initialized yet.
  console.error('Failed to start application:', error);
  process.exit(1);
});

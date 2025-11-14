import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet'; // ESM default import works in TS
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { NestWinstonLogger } from './logger/nest-winston.service';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }), // you use NestWinston instead
    { bufferLogs: true },
  );

  const logger = app.get(NestWinstonLogger);
  app.useLogger(logger);

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

  const configService = app.get(ConfigService);
  const allowedOrigins =
    configService
      .get<string>('ALLOWED_ORIGINS')
      ?.split(',')
      .map((origin) => origin.trim()) || [];

  await app.register(cors, {
    origin: allowedOrigins,
    credentials: true,
  });
  await app.register(helmet);
  await app.register(compress);
  await app.register(cookie, {
    secret: configService.get<string>('COOKIE_SECRET'),
  });

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = configService.get<number>('PORT') || 3001;
  await app.listen(port);

  logger.log(`🚀 Server is live and listening on port ${port} (${process.env.NODE_ENV ?? 'development'})`, 'Bootstrap');
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});

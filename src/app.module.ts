import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { RequestLoggerInterceptor } from './common/interceptors/request-logger.interceptor';
import { NestWinstonLogger } from './logger/nest-winston.service';
import { PrismaService } from './prisma/prisma.service';
import { UsersModule } from './users/users.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, UsersModule],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    NestWinstonLogger,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggerInterceptor,
    },
  ],
  exports: [NestWinstonLogger],
})
export class AppModule {}

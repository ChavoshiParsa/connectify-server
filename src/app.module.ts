import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AuthModule } from './api/v1/auth/auth.module';
import { DmModule } from './api/v1/dm/dm.module';
import { ProfileModule } from './api/v1/profile/profile.module';
import { UsersModule } from './api/v1/users/users.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RequestLoggerInterceptor } from './common/interceptors/request-logger.interceptor';
import { EventsModule } from './events/events.module';
import { NestPinoLogger } from './logger/nest-pino.service';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    AuthModule,
    UsersModule,
    DmModule,
    ProfileModule,
    EventsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    NestPinoLogger,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggerInterceptor,
    },
  ],
  exports: [NestPinoLogger],
})
export class AppModule {}

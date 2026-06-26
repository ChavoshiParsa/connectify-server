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
import { NestWinstonLogger } from './logger/nest-winston.service';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [
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

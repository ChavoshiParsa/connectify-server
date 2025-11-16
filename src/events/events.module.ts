import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from 'src/api/v1/users/users.module';
import { EventsGateway } from './events.gateway';

@Module({
  imports: [UsersModule, ConfigModule, JwtModule.register({})],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}

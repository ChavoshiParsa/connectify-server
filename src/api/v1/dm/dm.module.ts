import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { DmController } from './dm.controller';
import { DmService } from './dm.service';

@Module({
  imports: [UsersModule],
  providers: [DmService],
  controllers: [DmController],
  exports: [DmService],
})
export class DmModule {}

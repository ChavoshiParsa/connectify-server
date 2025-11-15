import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersModule } from '../users/users.module';
import { DmController } from './dm.controller';
import { DmService } from './dm.service';

@Module({
  imports: [UsersModule],
  providers: [DmService, PrismaService],
  controllers: [DmController],
  exports: [DmService],
})
export class DmModule {}

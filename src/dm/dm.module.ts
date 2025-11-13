import { Module } from '@nestjs/common';
import { UsersModule } from 'src/users/users.module';
import { PrismaService } from '../prisma/prisma.service';
import { DmController } from './dm.controller';
import { DmService } from './dm.service';

@Module({
  imports: [UsersModule],
  providers: [DmService, PrismaService],
  controllers: [DmController],
  exports: [DmService],
})
export class DmModule {}

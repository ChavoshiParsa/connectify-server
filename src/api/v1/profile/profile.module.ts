import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersModule } from '../users/users.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [UsersModule],
  providers: [ProfileService, PrismaService],
  controllers: [ProfileController],
  exports: [ProfileService],
})
export class ProfileModule {}

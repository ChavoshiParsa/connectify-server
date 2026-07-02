import { Global, Module } from '@nestjs/common';
import { AvatarStorageService } from './avatar-storage.service';
import { AvatarController } from './avatar.controller';

@Global()
@Module({
  controllers: [AvatarController],
  providers: [AvatarStorageService],
  exports: [AvatarStorageService],
})
export class AvatarModule {}

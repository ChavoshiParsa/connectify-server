import { Global, Module } from '@nestjs/common';
import { MessageMediaStorageService } from './message-media-storage.service';

@Global()
@Module({
  providers: [MessageMediaStorageService],
  exports: [MessageMediaStorageService],
})
export class MessageMediaModule {}

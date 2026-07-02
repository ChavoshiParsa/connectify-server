import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { AppFastifyReply } from 'src/common/types/http';
import { AvatarStorageService } from './avatar-storage.service';

@Controller('api/v1/avatars')
export class AvatarController {
  constructor(private readonly avatarStorage: AvatarStorageService) {}

  @Get(':id')
  async getAvatar(@Param('id') id: string, @Res() reply: AppFastifyReply) {
    const file = await this.avatarStorage.find(id);
    if (!file) throw new NotFoundException('Avatar not found');

    reply
      .header('Content-Type', (file.metadata?.contentType as string | undefined) || 'application/octet-stream')
      .header('Content-Length', file.length)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('ETag', `"${file._id.toHexString()}"`)
      .send(this.avatarStorage.openDownloadStream(id));
  }
}

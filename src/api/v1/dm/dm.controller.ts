import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { AppFastifyReply, AppFastifyRequest } from 'src/common/types/http';
import { MAX_MESSAGE_IMAGE_BYTES } from 'src/message-media/message-media.constants';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { DmService } from './dm.service';
import { DmKeyDto, GetRoomMessagesDto, MessageDto, SeenMessagesDto } from './dto';

@Controller('api/v1/dm')
@UseGuards(JwtGuard)
export class DmController {
  constructor(private dmService: DmService) {}

  @Get('my-rooms')
  async getMyRooms(@Req() req: AppFastifyRequest) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.getMyRooms(userId);
  }

  @Get('room-details/:dmKey')
  async getRoomDetails(@Req() req: AppFastifyRequest, @Param('dmKey') dmKey: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const sortedDmKey = DmKeyDto.sortAndValidate(dmKey);

    return this.dmService.getRoomDetails(userId, sortedDmKey);
  }

  @Get('room-messages/:dmKey')
  async getRoomMessages(
    @Req() req: AppFastifyRequest,
    @Param('dmKey') dmKey: string,
    @Query() query: GetRoomMessagesDto,
  ) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const sortedDmKey = DmKeyDto.sortAndValidate(dmKey);

    return this.dmService.getRoomMessages(userId, sortedDmKey, query.cursor, query.limit ?? 50);
  }

  @Get('message-details/:messageId')
  async getMessageDetails(@Req() req: AppFastifyRequest, @Param('messageId') messageId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.getMessageDetails(userId, messageId);
  }

  @Post('send-message/:recipientPublicId')
  async sendMessage(
    @Req() req: AppFastifyRequest,
    @Param('recipientPublicId') recipientPublicId: string,
    @Body() dto: MessageDto,
  ) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.sendMessage(userId, recipientPublicId, dto.content);
  }

  @Post('send-image/:recipientPublicId')
  async sendImage(@Req() req: AppFastifyRequest, @Param('recipientPublicId') recipientPublicId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const multipartRequest = req as unknown as MessageImageMultipartRequest;
    let image: MessageImageUpload | undefined;
    try {
      image = await multipartRequest.file({ limits: { files: 1, fileSize: MAX_MESSAGE_IMAGE_BYTES } });
    } catch {
      throw new BadRequestException('Image is too large');
    }

    if (!image || image.fieldname !== 'image') throw new BadRequestException('Image is required');

    let buffer: Buffer;
    try {
      buffer = await image.toBuffer();
    } catch {
      throw new BadRequestException('Image is too large');
    }

    const content = this.readStringField(image.fields.content)?.trim() ?? '';
    if (content.length > 5000) throw new BadRequestException('Message caption is too long');

    return this.dmService.sendImageMessage(userId, recipientPublicId, content, {
      buffer,
      mimeType: image.mimetype,
      fileName: image.filename,
    });
  }

  @Get('message-image/:messageId/:fileId')
  async getMessageImage(
    @Req() req: AppFastifyRequest,
    @Res() reply: AppFastifyReply,
    @Param('messageId') messageId: string,
    @Param('fileId') fileId: string,
  ) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const { file, attachment } = await this.dmService.getMessageImage(userId, messageId, fileId);
    reply
      .header('Content-Type', attachment.mimeType)
      .header('Content-Length', file.length)
      .header('Cache-Control', 'private, max-age=3600')
      .send(this.dmService.openMessageImage(fileId));
  }

  @Post('set-typing/:recipientPublicId')
  @HttpCode(200)
  async setTyping(@Req() req: AppFastifyRequest, @Param('recipientPublicId') recipientPublicId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.setTyping(userId, recipientPublicId);
  }

  @Post('seen-messages')
  @HttpCode(200)
  async seenMessages(@Req() req: AppFastifyRequest, @Body() dto: SeenMessagesDto) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.seenMessages(userId, dto.messageIds);
  }

  @Post('seen-message/:messageId')
  @HttpCode(200)
  async seenMessage(@Req() req: AppFastifyRequest, @Param('messageId') messageId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.seenMessages(userId, [messageId]);
  }

  @Post('seen-all-messages/:dmKey')
  @HttpCode(200)
  async seenAllMessages(@Req() req: AppFastifyRequest, @Param('dmKey') dmKey: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const sortedDmKey = DmKeyDto.sortAndValidate(dmKey);

    return this.dmService.seenAllMessages(userId, sortedDmKey);
  }

  @Patch('edit-message/:messageId')
  async editMessage(@Req() req: AppFastifyRequest, @Param('messageId') messageId: string, @Body() dto: MessageDto) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.editMessage(userId, messageId, dto.content);
  }

  @Delete('delete-message/:messageId')
  async deleteMessage(@Req() req: AppFastifyRequest, @Param('messageId') messageId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.deleteMessage(userId, messageId);
  }

  private readStringField(field?: MessageImagePart | MessageImagePart[]) {
    if (!field || Array.isArray(field) || field.type !== 'field') return undefined;
    return typeof field.value === 'string' ? field.value : undefined;
  }
}

type MessageImageField = {
  type: 'field';
  value: unknown;
};

type MessageImageUpload = {
  type: 'file';
  fieldname: string;
  filename: string;
  mimetype: string;
  fields: Record<string, MessageImagePart | MessageImagePart[] | undefined>;
  toBuffer: () => Promise<Buffer>;
};

type MessageImagePart = MessageImageField | MessageImageUpload;

type MessageImageMultipartRequest = {
  file: (options?: { limits?: { fileSize?: number; files?: number } }) => Promise<MessageImageUpload | undefined>;
};

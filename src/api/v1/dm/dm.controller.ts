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
import {
  MAX_FILE_MESSAGE_BYTES,
  MAX_MESSAGE_IMAGE_BYTES,
  MAX_VIDEO_MESSAGE_BYTES,
  MAX_VOICE_MESSAGE_BYTES,
  MAX_VOICE_MESSAGE_DURATION_MS,
} from 'src/message-media/message-media.constants';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { DmService } from './dm.service';
import { DmKeyDto, GetRoomMessagesDto, MessageDto, SearchRoomMessagesDto, SeenMessagesDto } from './dto';
import type { MultipartPart, MultipartRequest, MultipartUpload } from './types';

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

  @Get('search-messages/:dmKey')
  async searchRoomMessages(
    @Req() req: AppFastifyRequest,
    @Param('dmKey') dmKey: string,
    @Query() query: SearchRoomMessagesDto,
  ) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const sortedDmKey = DmKeyDto.sortAndValidate(dmKey);

    return this.dmService.searchRoomMessages(userId, sortedDmKey, query.q, query.cursor, query.limit ?? 50);
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

    return this.dmService.sendMessage(userId, recipientPublicId, dto.content, { replyToId: dto.replyToId });
  }

  @Post('send-image/:recipientPublicId')
  async sendImage(@Req() req: AppFastifyRequest, @Param('recipientPublicId') recipientPublicId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const multipartRequest = req as unknown as MultipartRequest;
    let image: MultipartUpload | undefined;
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
    const replyToId = this.readReplyToId(image.fields.replyToId);

    return this.dmService.sendImageMessage(
      userId,
      recipientPublicId,
      content,
      {
        buffer,
        mimeType: image.mimetype,
        fileName: image.filename,
      },
      replyToId,
    );
  }

  @Post('send-voice/:recipientPublicId')
  async sendVoice(@Req() req: AppFastifyRequest, @Param('recipientPublicId') recipientPublicId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const multipartRequest = req as unknown as MultipartRequest;
    let voice: MultipartUpload | undefined;
    try {
      voice = await multipartRequest.file({ limits: { files: 1, fileSize: MAX_VOICE_MESSAGE_BYTES } });
    } catch {
      throw new BadRequestException('Voice message is too large');
    }

    if (!voice || voice.fieldname !== 'voice') throw new BadRequestException('Voice message is required');

    let buffer: Buffer;
    try {
      buffer = await voice.toBuffer();
    } catch {
      throw new BadRequestException('Voice message is too large');
    }

    const durationMs = Number(this.readStringField(voice.fields.durationMs));
    if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > MAX_VOICE_MESSAGE_DURATION_MS) {
      throw new BadRequestException('Invalid voice message duration');
    }
    const replyToId = this.readReplyToId(voice.fields.replyToId);

    return this.dmService.sendVoiceMessage(
      userId,
      recipientPublicId,
      {
        buffer,
        mimeType: voice.mimetype,
        fileName: voice.filename,
        durationMs,
      },
      replyToId,
    );
  }

  @Post('send-video/:recipientPublicId')
  async sendVideo(@Req() req: AppFastifyRequest, @Param('recipientPublicId') recipientPublicId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');
    const upload = await this.readUpload(req, 'video', MAX_VIDEO_MESSAGE_BYTES);
    const rawDuration = this.readStringField(upload.fields.durationMs);
    const durationMs = rawDuration ? Number(rawDuration) : undefined;
    return this.dmService.sendVideoMessage(
      userId,
      recipientPublicId,
      {
        buffer: upload.buffer,
        mimeType: upload.part.mimetype,
        fileName: upload.part.filename,
        durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
      },
      this.readReplyToId(upload.fields.replyToId),
    );
  }

  @Post('send-file/:recipientPublicId')
  async sendFile(@Req() req: AppFastifyRequest, @Param('recipientPublicId') recipientPublicId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');
    const upload = await this.readUpload(req, 'file', MAX_FILE_MESSAGE_BYTES);
    return this.dmService.sendFileMessage(
      userId,
      recipientPublicId,
      {
        buffer: upload.buffer,
        mimeType: upload.part.mimetype,
        fileName: upload.part.filename,
      },
      this.readReplyToId(upload.fields.replyToId),
    );
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
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=3600')
      .send(this.dmService.openMessageImage(fileId));
  }

  @Get('message-media/:messageId/:fileId')
  async getMessageMedia(
    @Req() req: AppFastifyRequest,
    @Res() reply: AppFastifyReply,
    @Param('messageId') messageId: string,
    @Param('fileId') fileId: string,
  ) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const { file, attachment } = await this.dmService.getMessageMedia(userId, messageId, fileId);
    reply
      .header('Content-Type', attachment.mimeType)
      .header('Content-Length', file.length)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=3600')
      .send(this.dmService.openMessageMedia(fileId));
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

  private readStringField(field?: MultipartPart | MultipartPart[]) {
    if (!field || Array.isArray(field) || field.type !== 'field') return undefined;
    return typeof field.value === 'string' ? field.value : undefined;
  }

  private readReplyToId(field?: MultipartPart | MultipartPart[]) {
    const value = this.readStringField(field)?.trim();
    if (!value) return undefined;
    if (!/^[a-f\d]{24}$/i.test(value)) throw new BadRequestException('Invalid reply message ID');
    return value;
  }

  private async readUpload(req: AppFastifyRequest, fieldName: string, maxBytes: number) {
    const multipartRequest = req as unknown as MultipartRequest;
    let part: MultipartUpload | undefined;
    try {
      part = await multipartRequest.file({ limits: { files: 1, fileSize: maxBytes } });
    } catch {
      throw new BadRequestException('Uploaded file is too large');
    }
    if (!part || part.fieldname !== fieldName) throw new BadRequestException(`${fieldName} is required`);
    try {
      return { part, fields: part.fields, buffer: await part.toBuffer() };
    } catch {
      throw new BadRequestException('Uploaded file is too large');
    }
  }
}

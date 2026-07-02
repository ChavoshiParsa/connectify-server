import {
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
  UseGuards,
} from '@nestjs/common';
import type { AppFastifyRequest } from 'src/common/types/http';
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
}

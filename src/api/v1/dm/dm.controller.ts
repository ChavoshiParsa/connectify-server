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
import { Request } from 'express';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { DmService } from './dm.service';
import { DmKeyDto, GetRoomMessagesDto, MessageDto } from './dto';

@Controller('api/v1/dm')
@UseGuards(JwtGuard)
export class DmController {
  constructor(private dmService: DmService) {}

  @Get('my-rooms')
  async getMyRooms(@Req() req: Request) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.getMyRooms(userId);
  }

  @Get('room-details/:dmKey')
  async getRoomDetails(@Req() req: Request, @Param('dmKey') dmKey: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const sortedDmKey = DmKeyDto.sortAndValidate(dmKey);

    return this.dmService.getRoomDetails(userId, sortedDmKey);
  }

  @Get('room-messages/:dmKey')
  async getRoomMessages(@Req() req: Request, @Param('dmKey') dmKey: string, @Query() query: GetRoomMessagesDto) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const sortedDmKey = DmKeyDto.sortAndValidate(dmKey);

    return this.dmService.getRoomMessages(userId, sortedDmKey, query.cursor, query.limit ?? 50);
  }

  @Get('message-details/:messageId')
  async getMessageDetails(@Req() req: Request, @Param('messageId') messageId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.getMessageDetails(userId, messageId);
  }

  @Post('send-message/:recipientPublicId')
  async sendMessage(
    @Req() req: Request,
    @Param('recipientPublicId') recipientPublicId: string,
    @Body() dto: MessageDto,
  ) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.sendMessage(userId, recipientPublicId, dto.content);
  }

  @Post('set-typing/:recipientPublicId')
  @HttpCode(200)
  async setTyping(@Req() req: Request, @Param('recipientPublicId') recipientPublicId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.setTyping(userId, recipientPublicId);
  }

  @Post('seen-message/:messageId')
  @HttpCode(200)
  async seenMessage(@Req() req: Request, @Param('messageId') messageId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.seenMessage(userId, messageId);
  }

  @Post('seen-all-messages/:dmKey')
  @HttpCode(200)
  async seenAllMessages(@Req() req: Request, @Param('dmKey') dmKey: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const sortedDmKey = DmKeyDto.sortAndValidate(dmKey);

    return this.dmService.seenAllMessages(userId, sortedDmKey);
  }

  @Patch('edit-message/:messageId')
  async editMessage(@Req() req: Request, @Param('messageId') messageId: string, @Body() dto: MessageDto) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.editMessage(userId, messageId, dto.content);
  }

  @Delete('delete-message/:messageId')
  async deleteMessage(@Req() req: Request, @Param('messageId') messageId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.deleteMessage(userId, messageId);
  }
}

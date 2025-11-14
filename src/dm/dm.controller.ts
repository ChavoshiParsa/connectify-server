import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { DmService } from './dm.service';
import { GetRoomMessagesDto, MessageDto } from './dto';

@Controller('dm')
@UseGuards(JwtGuard)
export class DmController {
  constructor(private dmService: DmService) {}

  @Get('my-rooms')
  async getMyRooms(@Req() req: FastifyRequest) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.getMyRooms(userId);
  }

  @Get('room-details/:dmKey')
  async getRoomDetails(@Req() req: FastifyRequest, @Param('dmKey') dmKey: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.getRoomDetails(userId, dmKey);
  }

  @Get('room-messages/:dmKey')
  async getRoomMessages(@Req() req: FastifyRequest, @Param('dmKey') dmKey: string, @Query() query: GetRoomMessagesDto) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.getRoomMessages(userId, dmKey, query.cursor, query.limit ?? 50);
  }

  @Get('message-details/:messageId')
  async getMessage(@Req() req: FastifyRequest, @Param('messageId') messageId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.getMessage(userId, messageId);
  }

  @Post('send-message/:recipientPublicId')
  async sendMessage(
    @Req() req: FastifyRequest,
    @Param('recipientPublicId') recipientPublicId: string,
    @Body() dto: MessageDto,
  ) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.sendMessage(userId, recipientPublicId, dto.content);
  }

  @Post('set-typing/:recipientPublicId')
  async setTyping(@Req() req: FastifyRequest, @Param('recipientPublicId') recipientPublicId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.setTyping(userId, recipientPublicId);
  }

  @Post('seen-message/:messageId')
  async seenMessage(@Req() req: FastifyRequest, @Param('messageId') messageId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    await this.dmService.seenMessage(userId, messageId);
    return { message: 'Message marked as seen' };
  }

  @Post('seen-all-messages/:dmKey')
  async seenAllMessages(@Req() req: FastifyRequest, @Param('dmKey') dmKey: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    await this.dmService.seenAllMessages(userId, dmKey);
    return { message: 'All messages marked as seen' };
  }

  @Patch('edit-message/:messageId')
  async editMessage(@Req() req: FastifyRequest, @Param('messageId') messageId: string, @Body() dto: MessageDto) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.editMessage(userId, messageId, dto.content);
  }

  @Delete('delete-message/:messageId')
  async deleteMessage(@Req() req: FastifyRequest, @Param('messageId') messageId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.deleteMessage(userId, messageId);
  }
}

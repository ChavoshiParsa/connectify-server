import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { DmService } from './dm.service';
import { SeenAllMessagesDto, SeenMessageDto, SendMessageDto } from './dto';

@Controller('dm')
@UseGuards(JwtGuard)
export class DmController {
  constructor(private dmService: DmService) {}

  @Post('send-message')
  async sendMessage(@Body() dto: SendMessageDto, @Req() req: FastifyRequest) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    return this.dmService.sendMessage(userId, dto);
  }

  @Post('seen-message')
  async seenMessage(@Body() dto: SeenMessageDto, @Req() req: FastifyRequest) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    await this.dmService.seenMessage(userId, dto);
    return { message: 'Message marked as seen' };
  }

  @Post('seen-all-messages')
  async seenAllMessages(@Body() dto: SeenAllMessagesDto, @Req() req: FastifyRequest) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    await this.dmService.seenAllMessages(userId, dto);
    return { message: 'All messages marked as seen' };
  }
}

import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  async getMe(@Req() req: Request) {
    const userId = req.user?.userId;

    if (!userId) throw new ForbiddenException('Access denied');

    return this.usersService.getMe(userId);
  }

  @Get('me/unread-count')
  async getTotalUnreadCount(@Req() req: Request) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const count = await this.usersService.getTotalUnreadCount(userId);
    return { unreadCount: count };
  }

  @Get('search')
  async searchUsers(@Req() req: Request, @Query('q') q?: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const results = await this.usersService.searchUsers(userId, q ?? '', 3);
    return { results };
  }
}

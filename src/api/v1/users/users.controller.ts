import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { AppFastifyRequest } from 'src/common/types/http';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { UsersService } from './users.service';

@Controller('api/v1/users')
@UseGuards(JwtGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  async getMe(@Req() req: AppFastifyRequest) {
    const userId = req.user?.userId;

    if (!userId) throw new ForbiddenException('Access denied');

    return this.usersService.getMe(userId);
  }

  @Get('me/unread-count')
  async getTotalUnreadCount(@Req() req: AppFastifyRequest) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const count = await this.usersService.getTotalUnreadCount(userId);
    return { unreadCount: count };
  }

  @Get('search')
  async searchUsers(@Req() req: AppFastifyRequest, @Query('q') q?: string) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const results = await this.usersService.searchUsers(userId, q ?? '', 3);
    return results;
  }
}

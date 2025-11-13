import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtGuard)
  async getMe(@Req() req: FastifyRequest) {
    const userId = req.user?.userId;

    if (!userId) throw new ForbiddenException('Access denied');

    return this.usersService.getMe(userId);
  }
}

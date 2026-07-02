import { Body, Controller, ForbiddenException, Get, Patch, Query, Req, UseGuards } from '@nestjs/common';
import type { AppFastifyRequest } from 'src/common/types/http';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { UsersService } from '../users/users.service';
import { CheckUsernameDto, UpdateAvatarDto, UpdateProfileDto } from './dto';
import { ProfileService } from './profile.service';

@Controller('api/v1/profile')
@UseGuards(JwtGuard)
export class ProfileController {
  constructor(
    private profileService: ProfileService,
    private usersService: UsersService,
  ) {}

  @Get('check-username')
  async checkUsername(@Query() dto: CheckUsernameDto) {
    const isAvailable = await this.usersService.isUsernameAvailable(dto.username);
    return { isAvailable };
  }

  @Patch('update-profile')
  async updateProfile(@Body() dto: UpdateProfileDto, @Req() req: AppFastifyRequest) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const result = await this.profileService.updateProfile(dto, userId);
    return { result };
  }

  @Patch('update-avatar')
  async updateAvatar(@Body() dto: UpdateAvatarDto, @Req() req: AppFastifyRequest) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const result = await this.profileService.updateAvatar(dto, userId);
    return { result };
  }
}

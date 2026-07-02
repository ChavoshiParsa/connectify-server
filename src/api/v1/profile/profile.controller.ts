import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AppFastifyRequest } from 'src/common/types/http';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { UsersService } from '../users/users.service';
import { CheckUsernameDto, UpdateProfileDto } from './dto';
import { ProfileService } from './profile.service';
import { MAX_AVATAR_BYTES } from 'src/avatar/avatar.constants';

type AvatarUpload = {
  fieldname: string;
  mimetype: string;
  toBuffer: () => Promise<Buffer>;
};

type MultipartRequest = {
  file: (options?: { limits?: { fileSize?: number; files?: number } }) => Promise<AvatarUpload | undefined>;
};

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
  async updateAvatar(@Req() req: AppFastifyRequest) {
    const userId = req.user?.userId;
    if (!userId) throw new ForbiddenException('Access denied');

    const multipartRequest = req as unknown as MultipartRequest;
    let avatar: AvatarUpload | undefined;
    try {
      avatar = await multipartRequest.file({ limits: { files: 1, fileSize: MAX_AVATAR_BYTES } });
    } catch {
      throw new BadRequestException('Avatar image too large');
    }

    if (!avatar || avatar.fieldname !== 'avatar') {
      throw new BadRequestException('Avatar image is required');
    }

    let buffer: Buffer;
    try {
      buffer = await avatar.toBuffer();
    } catch {
      throw new BadRequestException('Avatar image too large');
    }

    const result = await this.profileService.updateAvatar(buffer, avatar.mimetype, userId);
    return { result };
  }
}

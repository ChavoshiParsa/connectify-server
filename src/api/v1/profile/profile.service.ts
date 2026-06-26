import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateAvatarDto, UpdateProfileDto } from './dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UsersService } from '../users/users.service';

@Injectable()
export class ProfileService {
  constructor(
    private usersService: UsersService,
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  async updateProfile(dto: UpdateProfileDto, userId: string) {
    const result = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        username: dto.username,
        biography: dto.biography,
      },
      omit: {
        id: true,
        passwordHash: true,
      },
    });

    this.eventEmitter.emit('user.profile.updated', {
      publicId: result.publicId,
      updatedFields: Object.entries(dto)
        .filter(([, v]) => v !== undefined)
        .map(([k]) => k),
    });

    return result;
  }

  async updateAvatar(dto: UpdateAvatarDto, userId: string) {
    if (dto.avatarBase64) {
      const bytes = this.usersService.base64DataUrlBytes(dto.avatarBase64);
      const MAX = 55 * 1024;
      if (bytes > MAX) {
        throw new BadRequestException('Avatar image too large');
      }
    }

    const result = await this.prisma.user.update({
      where: { id: userId },
      data: {
        avatarUrl: dto.avatarBase64,
      },
      omit: {
        id: true,
        passwordHash: true,
      },
    });

    this.eventEmitter.emit('user.profile.updated', {
      publicId: result.publicId,
      updatedFields: Object.entries(dto)
        .filter(([, v]) => v !== undefined)
        .map(([k]) => k),
    });

    return result;
  }
}

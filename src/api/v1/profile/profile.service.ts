import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AvatarStorageService } from 'src/avatar/avatar-storage.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { UpdateProfileDto } from './dto';

@Injectable()
export class ProfileService {
  constructor(
    private usersService: UsersService,
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private avatarStorage: AvatarStorageService,
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

  async updateAvatar(buffer: Buffer, contentType: string, userId: string) {
    const currentUser = await this.usersService.findById(userId);
    if (!currentUser) throw new NotFoundException('User not found');

    const avatarUrl = await this.avatarStorage.upload(buffer, contentType, currentUser.publicId);
    const result = await this.prisma.user
      .update({
        where: { id: userId },
        data: { avatarUrl },
        omit: {
          id: true,
          passwordHash: true,
        },
      })
      .catch(async (error: unknown) => {
        await this.avatarStorage.deleteByUrl(avatarUrl);
        throw error;
      });

    await this.avatarStorage.deleteByUrl(currentUser.avatarUrl);

    this.eventEmitter.emit('user.profile.updated', {
      publicId: result.publicId,
      updatedFields: ['avatarUrl'],
    });

    return result;
  }
}

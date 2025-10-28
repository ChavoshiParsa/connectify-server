import { Injectable } from '@nestjs/common';
import { AvatarColor, User } from 'generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { username: username.trim().toLowerCase() } });
  }

  async findByPublicId(publicId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { publicId } });
  }

  async createUser(data: {
    firstName: string;
    email: string;
    passwordHash: string;
    avatarColor: AvatarColor;
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        firstName: data.firstName,
        email: data.email.trim().toLowerCase(),
        passwordHash: data.passwordHash,
        avatarColor: data.avatarColor,
        roles: ['user'],
      },
    });
  }

  async updateLastLogin(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date(), lastActiveAt: new Date(), status: 'ONLINE' },
    });
  }
}

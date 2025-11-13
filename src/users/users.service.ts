import { Injectable } from '@nestjs/common';
import { AvatarColor, User, UserStatus } from 'generated/prisma/client';
import slugify from 'slugify';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getMe(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        publicId: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        biography: true,
        avatarUrl: true,
        avatarColor: true,
        roles: true,
        lastActiveAt: true,
        lastLoginAt: true,
      },
    });
  }

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
    lastName?: string;
    email: string;
    passwordHash: string;
    avatarUrl?: string;
    avatarColor: AvatarColor;
  }): Promise<User> {
    const username = await this.generateUniqueUsername(data.firstName, data.email);

    return this.prisma.user.create({
      data: {
        ...data,
        email: data.email.trim().toLowerCase(),
        username,
        roles: ['user'],
      },
    });
  }

  async updateLastLogin(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date(), lastActiveAt: new Date(), status: UserStatus.ONLINE },
    });
  }

  async updateLastActivity(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { lastActiveAt: new Date(), status: UserStatus.ONLINE },
    });
  }

  private async generateUniqueUsername(seedA?: string, seedB?: string) {
    const baseRaw = (seedA && seedA.trim()) || (seedB?.split('@')[0] ?? 'user');
    const base = slugify(baseRaw, { lower: true, strict: true }) || 'user';

    let candidate = base.toLowerCase();
    let i = 0;
    while (true) {
      const exists = await this.prisma.user.findUnique({
        where: { username: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
      i += 1;
      candidate = `${base}${i}`;
    }
  }
}

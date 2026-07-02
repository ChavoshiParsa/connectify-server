import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AvatarColor, UserStatus } from 'generated/prisma/client';
import slugify from 'slugify';
import { UserStatusPayload } from 'src/events/types';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  async getMe(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      omit: {
        id: true,
        passwordHash: true,
      },
    });
  }

  async getTotalUnreadCount(userId: string) {
    const result = await this.prisma.roomMember.aggregate({
      where: { userId },
      _sum: { unreadCount: true },
    });
    return result._sum.unreadCount || 0;
  }

  async searchUsers(userId: string, query: string, limit = 3) {
    if (!query || !query.trim()) {
      return [];
    }
    const q = query.trim();

    const matches = await this.prisma.user.findMany({
      where: {
        AND: [
          { id: { not: userId } },
          {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { username: { contains: q, mode: 'insensitive' } },
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
            ],
          },
        ],
      },
      orderBy: { lastActiveAt: 'desc' },
      omit: {
        id: true,
        passwordHash: true,
        lastLoginAt: true,
        roles: true,
        biography: true,
        updatedAt: true,
        createdAt: true,
      },
      take: limit,
    });

    if (matches.length === 0) return [];

    return matches;
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  }

  async findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username: username.trim().toLowerCase() } });
  }

  async findByPublicId(publicId: string) {
    return this.prisma.user.findUnique({ where: { publicId } });
  }

  async createUser(data: {
    firstName: string;
    lastName?: string;
    email: string;
    passwordHash: string;
    avatarUrl?: string;
    avatarColor: AvatarColor;
  }) {
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

  async updateLastLogin(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  async updateLastActivity(id: string, status: UserStatus, shouldEmit = true) {
    const now = new Date();

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        lastActiveAt: now,
        status,
      },
      select: {
        id: true,
        publicId: true,
        status: true,
        lastActiveAt: true,
      },
    });

    if (shouldEmit) {
      const payload: UserStatusPayload = {
        publicId: user.publicId,
        status: user.status,
        lastActiveAt: user.lastActiveAt as Date,
      };

      this.eventEmitter.emit('user.status', payload);
    }

    return user;
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

  async isUsernameAvailable(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: { publicId: true },
    });

    return !user;
  }

  getRandomAvatarColor(): AvatarColor {
    const colors = Object.values(AvatarColor);
    const randomIndex = Math.floor(Math.random() * colors.length);
    return colors[randomIndex];
  }
}

import { ForbiddenException, Injectable } from '@nestjs/common';
import { RoomType } from 'generated/prisma/enums';
import { UsersService } from 'src/users/users.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DmService {
  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
  ) {}

  async getMyRooms(userId: string) {
    const roomMembers = await this.prisma.roomMember.findMany({
      where: {
        userId,
        room: {
          type: RoomType.DM,
          lastMessageId: {
            not: null,
          },
        },
      },
      orderBy: {
        room: {
          updatedAt: 'desc',
        },
      },
      select: {
        unreadCount: true,
        room: {
          select: {
            dmKey: true,
            updatedAt: true,
            lastMessage: {
              select: {
                id: true,
                content: true,
                createdAt: true,
                editedAt: true,
                sender: {
                  select: {
                    firstName: true,
                    lastName: true,
                  },
                },
                receipts: {
                  select: {
                    readAt: true,
                  },
                },
              },
            },
            members: {
              where: {
                userId: { not: userId },
              },
              select: {
                user: {
                  omit: {
                    id: true,
                    passwordHash: true,
                    lastLoginAt: true,
                    roles: true,
                    biography: true,
                    updatedAt: true,
                    createdAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return roomMembers.map((rm) => ({
      dmKey: rm.room.dmKey,
      unreadCount: rm.unreadCount,
      lastMessage: rm.room.lastMessage,
      recipient: rm.room.members[0]?.user || null,
      updatedAt: rm.room.updatedAt,
    }));
  }

  async getRoomDetails(userId: string, dmKey: string) {
    return await this.prisma.room.findUnique({
      where: { type_dmKey: { type: RoomType.DM, dmKey } },
      select: {
        dmKey: true,
        members: true,
        updatedAt: true,
      },
    });
  }

  async getRoomMessages(userId: string, dmKey: string, cursor?: Date | string, limit: number = 50) {
    const validLimit = Math.min(Math.max(limit, 1), 100);

    const room = await this.prisma.room.findUnique({
      where: {
        type_dmKey: { type: RoomType.DM, dmKey },
        members: {
          some: { userId },
        },
      },
      select: { id: true },
    });

    if (!room) {
      throw new ForbiddenException('Room not found or access denied.');
    }

    const cursorDate = cursor ? (cursor instanceof Date ? cursor : new Date(cursor)) : new Date();

    if (cursor && isNaN(cursorDate.getTime())) {
      throw new ForbiddenException('Invalid cursor format. Expected ISO 8601 date string.');
    }

    const messages = await this.prisma.message.findMany({
      where: {
        roomId: room.id,
        deletedAt: { isSet: false },
        createdAt: { lt: cursorDate },
      },
      orderBy: { createdAt: 'desc' },
      take: validLimit + 1,
      select: {
        id: true,
        content: true,
        createdAt: true,
        editedAt: true,
        sender: {
          omit: {
            id: true,
            passwordHash: true,
            lastLoginAt: true,
            roles: true,
            biography: true,
            updatedAt: true,
            createdAt: true,
          },
        },
        receipts: {
          select: {
            deliveredAt: true,
            readAt: true,
          },
        },
      },
    });

    const hasMore = messages.length > validLimit;
    const resultMessages = hasMore ? messages.slice(0, -1) : messages;

    return {
      messages: resultMessages,
      nextCursor: hasMore ? resultMessages[resultMessages.length - 1].createdAt.toISOString() : null,
      hasMore,
    };
  }

  async getMessage(userId: string, messageId: string) {
    return await this.prisma.message.findUnique({
      where: {
        id: messageId,
        OR: [
          { senderId: userId },
          {
            room: {
              members: { some: { userId } },
            },
          },
        ],
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        editedAt: true,
        deletedAt: true,
        sender: {
          omit: {
            id: true,
            passwordHash: true,
            lastLoginAt: true,
            roles: true,
            biography: true,
            updatedAt: true,
            createdAt: true,
          },
        },
        room: {
          select: {
            dmKey: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  async sendMessage(userId: string, recipientPublicId: string, content: string) {
    const sender = await this.usersService.findById(userId);
    const recipient = await this.usersService.findByPublicId(recipientPublicId);

    if (!sender || !recipient) {
      throw new ForbiddenException('Invalid sender or recipient.');
    }

    const dmKey = this.makeDmKey(sender.publicId, recipient.publicId);

    const message = await this.prisma.$transaction(async (tx) => {
      const existingRoom = await tx.room.findUnique({
        where: { type_dmKey: { type: RoomType.DM, dmKey } },
      });

      if (existingRoom) {
        const message = await tx.message.create({
          data: {
            roomId: existingRoom.id,
            senderId: sender.id,
            content,
            receipts: { create: { userId: recipient.id } },
          },
          select: { id: true, content: true, createdAt: true },
        });

        await tx.roomMember.update({
          where: {
            roomId_userId: {
              roomId: existingRoom.id,
              userId: recipient.id,
            },
          },
          data: {
            unreadCount: { increment: 1 },
          },
        });

        await tx.room.update({
          where: { id: existingRoom.id },
          data: { lastMessageId: message.id },
        });

        return message;
      } else {
        const newRoom = await tx.room.create({
          data: {
            type: RoomType.DM,
            dmKey,
            members: {
              create: [{ userId: sender.id }, { userId: recipient.id, unreadCount: 1 }],
            },
          },
          select: { id: true },
        });

        const newMessage = await tx.message.create({
          data: {
            roomId: newRoom.id,
            senderId: sender.id,
            content,
            receipts: { create: { userId: recipient.id } },
          },
          select: { id: true, content: true, createdAt: true },
        });

        await tx.room.update({
          where: { id: newRoom.id },
          data: { lastMessageId: newMessage.id },
        });

        return newMessage;
      }
    });

    await this.usersService.updateLastActivity(sender.id);

    return {
      messageId: message.id,
      content: message.content,
      createdAt: message.createdAt,
      dmKey,
    };
  }

  async setTyping(userId: string, recipientPublicId: string) {
    // emit a event to recipientPublicId that is typing if room is there.
  }

  async seenMessage(userId: string, messageId: string) {
    await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.findUnique({
        where: { id: messageId },
        select: { roomId: true },
      });

      if (!message) {
        throw new ForbiddenException('Message not found.');
      }

      const receipt = await tx.messageReceipt.findUnique({
        where: {
          messageId_userId: { messageId, userId },
          readAt: {
            isSet: false,
          },
        },
        select: { readAt: true },
      });

      if (!receipt) {
        throw new ForbiddenException('Message receipt not found.');
      }

      await tx.messageReceipt.update({
        where: {
          messageId_userId: { messageId, userId },
        },
        data: { readAt: new Date() },
      });

      await tx.roomMember.update({
        where: {
          roomId_userId: {
            roomId: message.roomId,
            userId,
          },
          unreadCount: { gt: 0 },
        },
        data: {
          unreadCount: { decrement: 1 },
        },
      });
    });
  }

  async seenAllMessages(userId: string, dmKey: string) {
    const room = await this.prisma.room.findUnique({
      where: { type_dmKey: { type: RoomType.DM, dmKey } },
      select: { id: true },
    });

    if (!room) {
      throw new ForbiddenException('Room not found.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.messageReceipt.updateMany({
        where: {
          userId,
          message: {
            roomId: room.id,
          },
          readAt: {
            isSet: false,
          },
        },
        data: {
          readAt: new Date(),
        },
      });

      await tx.roomMember.update({
        where: {
          roomId_userId: {
            roomId: room.id,
            userId,
          },
        },
        data: {
          unreadCount: 0,
        },
      });
    });
  }

  async editMessage(userId: string, messageId: string, content: string) {
    const message = await this.prisma.message.update({
      where: { id: messageId, senderId: userId, deletedAt: { isSet: false } },
      data: { content, editedAt: new Date() },
    });

    if (!message) {
      throw new ForbiddenException('Message not found.');
    }
  }

  async deleteMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.update({
      where: { id: messageId, senderId: userId, deletedAt: { isSet: false } },
      data: { deletedAt: new Date() },
    });

    console.log('message', message);

    if (!message) {
      throw new ForbiddenException('Message not found.');
    }
  }

  private makeDmKey(a: string, b: string): string {
    return [a, b].sort().join('~');
  }

  // private parseDmKey(dmKey: string): [string, string] {
  //   const parts = dmKey.split('~');
  //   if (parts.length !== 2) throw new Error('Invalid dmKey format');
  //   return parts as [string, string];
  // }
}

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RoomType } from 'generated/prisma/enums';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class DmService {
  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
    private eventEmitter: EventEmitter2,
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
    this.validateDmKey(dmKey);

    const room = await this.prisma.room.findUnique({
      where: { type_dmKey: { type: RoomType.DM, dmKey }, members: { some: { userId } } },
      select: {
        dmKey: true,
        members: true,
        updatedAt: true,
      },
    });

    if (!room) {
      throw new NotFoundException('Room not found or access denied.');
    }

    return room;
  }

  async getRoomMessages(userId: string, dmKey: string, cursor?: Date | string, limit: number = 50) {
    this.validateDmKey(dmKey);

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
      throw new NotFoundException('Room not found or access denied.');
    }

    const cursorDate = cursor ? (cursor instanceof Date ? cursor : new Date(cursor)) : new Date();

    if (cursor && isNaN(cursorDate.getTime())) {
      throw new BadRequestException('Invalid cursor format. Expected ISO 8601 date string.');
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
    const message = await this.prisma.message.findUnique({
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

    if (!message) {
      throw new NotFoundException('Message not found.');
    }

    return message;
  }

  async sendMessage(userId: string, recipientPublicId: string, content: string) {
    const sender = await this.usersService.findById(userId);
    const recipient = await this.usersService.findByPublicId(recipientPublicId);

    if (!sender || !recipient) {
      throw new NotFoundException('Invalid sender or recipient.');
    }

    if (sender.publicId === recipient.publicId) {
      throw new BadRequestException('Cannot send message to yourself.');
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

    this.eventEmitter.emit('message.new', {
      messageId: message.id,
      dmKey,
      senderPublicId: sender.publicId,
      recipientPublicId: recipient.publicId,
      createdAt: message.createdAt,
    });

    return {
      messageId: message.id,
      content: message.content,
      createdAt: message.createdAt,
      dmKey,
    };
  }

  async editMessage(userId: string, messageId: string, content: string) {
    const existingMessage = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        senderId: userId,
        deletedAt: { isSet: false },
      },
    });

    if (!existingMessage) {
      throw new NotFoundException('Message not found or you do not have permission to edit it.');
    }

    const message = await this.prisma.message.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
      select: {
        id: true,
        content: true,
        editedAt: true,
        room: {
          select: {
            dmKey: true,
          },
        },
        sender: {
          select: {
            publicId: true,
          },
        },
      },
    });

    const recipientPublicId = this.getPartnerPublicKey(message.sender.publicId, message.room.dmKey as string);

    this.eventEmitter.emit('message.edited', {
      messageId: message.id,
      dmKey: message.room.dmKey,
      editorPublicId: message.sender.publicId,
      recipientPublicId,
      editedAt: message.editedAt,
    });

    return {
      success: true,
      messageId: message.id,
      content: message.content,
      editedAt: message.editedAt,
    };
  }

  async deleteMessage(userId: string, messageId: string) {
    const existingMessage = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        senderId: userId,
        deletedAt: { isSet: false },
      },
    });

    if (!existingMessage) {
      throw new NotFoundException('Message not found or you do not have permission to delete it.');
    }

    const message = await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
      select: {
        id: true,
        deletedAt: true,
        room: {
          select: {
            dmKey: true,
          },
        },
        sender: {
          select: {
            publicId: true,
          },
        },
      },
    });

    const recipientPublicId = this.getPartnerPublicKey(message.sender.publicId, message.room.dmKey as string);

    this.eventEmitter.emit('message.deleted', {
      messageId: message.id,
      dmKey: message.room.dmKey,
      deletedByPublicId: message.sender.publicId,
      recipientPublicId,
      deletedAt: message.deletedAt,
    });

    return {
      success: true,
      messageId: message.id,
      deletedAt: message.deletedAt,
    };
  }

  async seenMessage(userId: string, messageId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.findUnique({
        where: { id: messageId },
        select: {
          roomId: true,
          senderId: true,
          sender: {
            select: { publicId: true },
          },
          room: {
            select: {
              dmKey: true,
            },
          },
        },
      });

      if (!message) {
        throw new NotFoundException('Message not found.');
      }

      if (message.senderId === userId) {
        throw new BadRequestException('You cannot mark your own messages as read.');
      }

      const receipt = await tx.messageReceipt.findUnique({
        where: {
          messageId_userId: { messageId, userId },
        },
        select: { readAt: true },
      });

      if (!receipt) {
        throw new NotFoundException('Message receipt not found. You may not have access to this message.');
      }

      if (receipt.readAt) {
        return { alreadyRead: true };
      }

      await tx.messageReceipt.update({
        where: {
          messageId_userId: { messageId, userId },
        },
        data: { readAt: new Date() },
      });

      await tx.roomMember.updateMany({
        where: {
          roomId: message.roomId,
          userId,
          unreadCount: { gt: 0 },
        },
        data: {
          unreadCount: { decrement: 1 },
        },
      });

      return { alreadyRead: false, readAt: new Date(), publicId: message.sender.publicId, dm: message.room.dmKey };
    });

    if (!result.alreadyRead) {
      const senderPublicId = result.publicId as string;
      const seenByPublicId = this.getPartnerPublicKey(senderPublicId, result.dm as string);

      this.eventEmitter.emit('message.seen', {
        messageId,
        dmKey: result.dm as string,
        seenByPublicId: seenByPublicId,
        recipientPublicId: senderPublicId,
        readAt: result.readAt,
      });
    }

    return {
      success: true,
      messageId,
      alreadyRead: result.alreadyRead,
    };
  }

  async seenAllMessages(userId: string, dmKey: string) {
    this.validateDmKey(dmKey);

    const room = await this.prisma.room.findUnique({
      where: { type_dmKey: { type: RoomType.DM, dmKey } },
      select: { id: true },
    });

    if (!room) {
      throw new NotFoundException('Room not found.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const membership = await tx.roomMember.findUnique({
        where: {
          roomId_userId: {
            roomId: room.id,
            userId,
          },
        },
      });

      if (!membership) {
        throw new ForbiddenException('You are not a member of this room.');
      }

      const updateResult = await tx.messageReceipt.updateMany({
        where: {
          userId,
          message: {
            roomId: room.id,
            senderId: { not: userId },
          },
          readAt: { isSet: false },
        },
        data: {
          readAt: new Date(),
        },
      });

      if (updateResult.count > 0) {
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
      }

      return { count: updateResult.count, read: new Date() };
    });

    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const recipientPublicId = this.getPartnerPublicKey(user.publicId, dmKey);

    this.eventEmitter.emit('message.seen.all', {
      dmKey,
      seenAllByPublicId: user.publicId,
      recipientPublicId,
      readAt: result.read,
    });

    return {
      success: true,
      dmKey,
      messagesMarkedRead: result.count,
    };
  }

  async setTyping(userId: string, recipientPublicId: string) {
    const sender = await this.usersService.findById(userId);
    const recipient = await this.usersService.findByPublicId(recipientPublicId);

    if (!sender || !recipient) {
      throw new NotFoundException('Invalid sender or recipient.');
    }

    const dmKey = this.makeDmKey(sender.publicId, recipient.publicId);

    this.eventEmitter.emit('typing.start', {
      dmKey,
      userPublicId: sender.publicId,
      recipientPublicId: recipient.publicId,
    });

    return {
      success: true,
      dmKey,
      recipientPublicId,
    };
  }

  private makeDmKey(a: string, b: string): string {
    return [a, b].sort().join('~');
  }

  private validateDmKey(dmKey: string): void {
    if (!dmKey || typeof dmKey !== 'string') {
      throw new BadRequestException('DM key is required.');
    }

    const parts = dmKey.split('~');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new BadRequestException('Invalid DM key format. Expected format: userA~userB');
    }

    if (parts[0] > parts[1]) {
      throw new BadRequestException('Invalid DM key format. User IDs must be in sorted order.');
    }
  }

  private parseDmKey(dmKey: string): [string, string] {
    this.validateDmKey(dmKey);
    return dmKey.split('~') as [string, string];
  }

  private getPartnerPublicKey(publicId: string, dmKey: string) {
    const [a, b] = this.parseDmKey(dmKey);

    if (publicId === a) {
      return b;
    } else if (publicId === b) {
      return a;
    } else {
      throw new BadRequestException('Public ID is not part of the DM key.');
    }
  }
}

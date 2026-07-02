import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from 'generated/prisma/client';
import { RoomType, UserStatus } from 'generated/prisma/enums';
import { MessageMediaStorageService } from 'src/message-media/message-media-storage.service';
import type { ImageMessageAttachment } from 'src/message-media/message-media.types';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class DmService {
  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
    private eventEmitter: EventEmitter2,
    private messageMediaStorage: MessageMediaStorageService,
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
          select: this.dmRoomSelectForUser(userId),
        },
      },
    });

    return roomMembers.map((rm) => {
      const room = rm.room;
      const recipient = room.members[0]?.user;

      if (!recipient) {
        throw new NotFoundException('Recipient not found for this DM room.');
      }

      return {
        dmKey: room.dmKey as string,
        updatedAt: room.updatedAt,
        lastMessage: room.lastMessage,
        members: room.members,
        recipient,
        unreadCount: rm.unreadCount,
      };
    });
  }

  async getRoomDetails(userId: string, dmKey: string) {
    const room = await this.prisma.room.findFirst({
      where: {
        type: RoomType.DM,
        dmKey,
        members: {
          some: { userId },
        },
      },
      select: this.dmRoomSelectForUser(userId),
    });

    if (!room) {
      // throw new NotFoundException('Room not found or access denied.');
      const sender = await this.usersService.findById(userId);
      const publicId = this.getPartnerPublicKey(sender!.publicId, dmKey) as string;

      const recipient = await this.prisma.user.findUnique({ where: { publicId }, omit: this.safeUserSelect.omit });

      return {
        dmKey,
        updatedAt: null,
        lastMessage: null,
        members: [],
        recipient,
      };
    }

    const recipient = room.members[0]?.user;

    if (!recipient) {
      throw new NotFoundException('Recipient not found for this DM room.');
    }

    return {
      dmKey: room.dmKey as string,
      updatedAt: room.updatedAt,
      lastMessage: room.lastMessage,
      members: room.members,
      recipient,
    };
  }

  async getRoomMessages(userId: string, dmKey: string, cursor?: Date | string, limit: number = 50) {
    const validLimit = Math.min(Math.max(limit, 1), 100);

    const room = await this.prisma.room.findFirst({
      where: {
        type: RoomType.DM,
        dmKey,
        members: { some: { userId } },
      },
      select: { id: true },
    });

    if (!room) {
      // throw new NotFoundException('Room not found or access denied.');

      return {
        messages: [],
        nextCursor: null,
        hasMore: false,
      };
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
      select: this.messageBaseSelect,
    });

    const hasMore = messages.length > validLimit;
    const resultMessages = hasMore ? messages.slice(0, -1) : messages;

    return {
      messages: resultMessages,
      nextCursor: hasMore ? resultMessages[resultMessages.length - 1].createdAt.toISOString() : null,
      hasMore,
    };
  }

  async getMessageDetails(userId: string, messageId: string) {
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        deletedAt: { isSet: false },
        OR: [
          { senderId: userId },
          {
            room: {
              members: { some: { userId } },
            },
          },
        ],
      },
      select: this.messageWithRoomSelect,
    });

    if (!message) {
      throw new NotFoundException('Message not found.');
    }

    return message;
  }

  async sendImageMessage(
    userId: string,
    recipientPublicId: string,
    content: string,
    image: { buffer: Buffer; mimeType: string; fileName: string },
  ) {
    const sender = await this.usersService.findById(userId);
    const recipient = await this.usersService.findByPublicId(recipientPublicId);
    if (!sender || !recipient) throw new NotFoundException('Invalid sender or recipient.');
    if (sender.publicId === recipient.publicId) throw new BadRequestException('Cannot send message to yourself.');

    const attachment = await this.messageMediaStorage.uploadImage(image.buffer, image.mimeType, image.fileName, userId);
    return this.sendMessage(userId, recipientPublicId, content, [attachment]);
  }

  async sendMessage(
    userId: string,
    recipientPublicId: string,
    content: string,
    attachments?: ImageMessageAttachment[],
  ) {
    const sender = await this.usersService.findById(userId);
    const recipient = await this.usersService.findByPublicId(recipientPublicId);

    if (!sender || !recipient) {
      throw new NotFoundException('Invalid sender or recipient.');
    }

    if (sender.publicId === recipient.publicId) {
      throw new BadRequestException('Cannot send message to yourself.');
    }

    const dmKey = this.makeDmKey(sender.publicId, recipient.publicId);

    const message = await this.prisma
      .$transaction(async (tx) => {
        const existingRoom = await tx.room.findUnique({
          where: { type_dmKey: { type: RoomType.DM, dmKey } },
        });

        if (existingRoom) {
          const message = await tx.message.create({
            data: {
              roomId: existingRoom.id,
              senderId: sender.id,
              content,
              attachments: attachments?.length ? (attachments as Prisma.InputJsonValue) : undefined,
              receipts: { create: { userId: recipient.id } },
            },
            select: { id: true, content: true, attachments: true, createdAt: true },
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
              attachments: attachments?.length ? (attachments as Prisma.InputJsonValue) : undefined,
              receipts: { create: { userId: recipient.id } },
            },
            select: { id: true, content: true, attachments: true, createdAt: true },
          });

          await tx.room.update({
            where: { id: newRoom.id },
            data: { lastMessageId: newMessage.id },
          });

          return newMessage;
        }
      })
      .catch(async (error: unknown) => {
        await Promise.allSettled(
          (attachments ?? []).map((attachment) => this.messageMediaStorage.delete(attachment.fileId)),
        );
        throw error;
      });

    await this.usersService.updateLastActivity(sender.id, UserStatus.ONLINE, false);

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
      attachments: message.attachments,
      createdAt: message.createdAt,
      dmKey,
    };
  }

  async getMessageImage(userId: string, messageId: string, fileId: string) {
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        deletedAt: { isSet: false },
        room: { members: { some: { userId } } },
      },
      select: { attachments: true },
    });

    const attachment = this.getImageAttachments(message?.attachments).find((item) => item.fileId === fileId);
    if (!attachment) throw new NotFoundException('Message image not found.');

    const file = await this.messageMediaStorage.find(fileId);
    if (!file) throw new NotFoundException('Message image not found.');

    return { file, attachment };
  }

  openMessageImage(fileId: string) {
    return this.messageMediaStorage.openDownloadStream(fileId);
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

    await Promise.allSettled(
      this.getImageAttachments(existingMessage.attachments).map((attachment) =>
        this.messageMediaStorage.delete(attachment.fileId),
      ),
    );

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

  async seenMessages(userId: string, messageIds: string[]) {
    const uniqueMessageIds = [...new Set(messageIds)].filter(Boolean);

    if (uniqueMessageIds.length === 0) {
      return { success: true, updated: [] };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const messages = await tx.message.findMany({
        where: {
          id: { in: uniqueMessageIds },
        },
        select: {
          id: true,
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

      if (messages.length === 0) {
        return { updated: [], errors: [] };
      }

      const validMessages = messages.filter((msg) => msg.senderId !== userId);

      if (validMessages.length === 0) {
        return { updated: [], errors: [] };
      }

      const validMessageIds = validMessages.map((msg) => msg.id);

      const receipts = await tx.messageReceipt.findMany({
        where: {
          messageId: { in: validMessageIds },
          userId,
        },
        select: {
          messageId: true,
          readAt: true,
        },
      });

      const unreadReceipts = receipts.filter((r) => !r.readAt);
      const unreadMessageIds = unreadReceipts.map((r) => r.messageId);

      if (unreadMessageIds.length === 0) {
        return { updated: [], errors: [] };
      }

      const readAt = new Date();

      await tx.messageReceipt.updateMany({
        where: {
          messageId: { in: unreadMessageIds },
          userId,
          readAt: { isSet: false },
        },
        data: { readAt },
      });

      const roomIds = [...new Set(validMessages.map((m) => m.roomId))];

      await tx.roomMember.updateMany({
        where: {
          roomId: { in: roomIds },
          userId,
          unreadCount: { gt: 0 },
        },
        data: {
          unreadCount: {
            decrement: unreadMessageIds.length,
          },
        },
      });

      const updated = unreadMessageIds.map((msgId) => {
        const message = validMessages.find((m) => m.id === msgId);
        return {
          messageId: msgId,
          readAt,
          publicId: message?.sender.publicId,
          dmKey: message?.room.dmKey,
        };
      });

      return { updated, errors: [] };
    });

    const first = result.updated[0];

    const seenByPublicId = this.getPartnerPublicKey(first.publicId as string, first.dmKey as string);

    this.eventEmitter.emit('messages.seen', {
      messageIds: result.updated.map((u) => u.messageId),
      dmKey: first.dmKey,
      seenByPublicId,
      recipientPublicId: first.publicId,
      readAt: first.readAt,
    });

    return {
      success: true,
      updated: result.updated.map((u) => u.messageId),
      count: result.updated.length,
    };
  }

  async seenAllMessages(userId: string, dmKey: string) {
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

      const readAt = new Date();

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
          readAt,
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

      return { count: updateResult.count, read: readAt };
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

  private getPartnerPublicKey(publicId: string, dmKey: string): string | null {
    const [a, b] = dmKey.split('~') as [string, string];
    return publicId === a ? b : publicId === b ? a : null;
  }

  private readonly safeUserSelect = {
    omit: {
      id: true,
      passwordHash: true,
      lastLoginAt: true,
      roles: true,
      biography: true,
      updatedAt: true,
      createdAt: true,
    },
  } as const;

  private readonly lastMessageSelect = {
    id: true,
    content: true,
    attachments: true,
    createdAt: true,
    editedAt: true,
    sender: {
      select: {
        firstName: true,
        lastName: true,
        publicId: true,
      },
    },
    receipts: {
      select: {
        readAt: true,
      },
    },
  } as const;

  private get messageBaseSelect() {
    return {
      id: true,
      content: true,
      attachments: true,
      createdAt: true,
      editedAt: true,
      sender: this.safeUserSelect,
      receipts: {
        select: {
          deliveredAt: true,
          readAt: true,
        },
      },
    } as const;
  }

  private get messageWithRoomSelect() {
    return {
      ...this.messageBaseSelect,
      room: {
        select: {
          dmKey: true,
          updatedAt: true,
        },
      },
    } as const;
  }

  private dmRoomSelectForUser(userId: string) {
    return {
      dmKey: true,
      updatedAt: true,
      lastMessage: {
        select: this.lastMessageSelect,
      },
      members: {
        where: {
          userId: { not: userId },
        },
        select: {
          user: this.safeUserSelect,
        },
      },
    } as const;
  }

  private getImageAttachments(value: Prisma.JsonValue | null | undefined): ImageMessageAttachment[] {
    if (!Array.isArray(value)) return [];

    return value.filter((item): item is ImageMessageAttachment => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      return (
        item.type === 'IMAGE' &&
        typeof item.fileId === 'string' &&
        typeof item.fileName === 'string' &&
        typeof item.mimeType === 'string' &&
        typeof item.size === 'number'
      );
    });
  }
}

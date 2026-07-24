import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from 'generated/prisma/client';
import { RoomType, UserStatus } from 'generated/prisma/enums';
import { MessageMediaStorageService } from 'src/message-media/message-media-storage.service';
import type { ImageMessageAttachment, MessageMediaAttachment } from 'src/message-media/message-media.types';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type { SendMessageOptions, UploadedFile, UploadedImage, UploadedVideo, UploadedVoice } from './types';

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
      select: this.dmRoomDetailsSelectForUser(userId),
    });

    if (!room) {
      // throw new NotFoundException('Room not found or access denied.');
      const sender = await this.usersService.findById(userId);
      const publicId = this.getPartnerPublicKey(sender!.publicId, dmKey) as string;

      const recipient = await this.prisma.user.findUnique({
        where: { publicId },
        omit: this.chatProfileUserSelect.omit,
      });

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

  async searchRoomMessages(userId: string, dmKey: string, query: string, cursor?: Date | string, limit: number = 50) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new BadRequestException('Search query is required.');

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
      return {
        results: [],
        nextCursor: null,
        hasMore: false,
        total: 0,
      };
    }

    const cursorDate = cursor ? (cursor instanceof Date ? cursor : new Date(cursor)) : new Date();
    if (cursor && isNaN(cursorDate.getTime())) {
      throw new BadRequestException('Invalid cursor format. Expected ISO 8601 date string.');
    }

    const searchWhere: Prisma.MessageWhereInput = {
      roomId: room.id,
      deletedAt: { isSet: false },
      content: {
        contains: normalizedQuery,
        mode: 'insensitive',
      },
    };

    const [total, matches] = await Promise.all([
      this.prisma.message.count({ where: searchWhere }),
      this.prisma.message.findMany({
        where: {
          ...searchWhere,
          createdAt: { lt: cursorDate },
        },
        orderBy: { createdAt: 'desc' },
        take: validLimit + 1,
        select: {
          id: true,
          createdAt: true,
        },
      }),
    ]);

    const hasMore = matches.length > validLimit;
    const results = hasMore ? matches.slice(0, validLimit) : matches;

    return {
      results,
      nextCursor: hasMore ? results[results.length - 1].createdAt.toISOString() : null,
      hasMore,
      total,
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
    image: UploadedImage,
    replyToId?: string,
  ) {
    const sender = await this.usersService.findById(userId);
    const recipient = await this.usersService.findByPublicId(recipientPublicId);
    if (!sender || !recipient) throw new NotFoundException('Invalid sender or recipient.');
    if (sender.publicId === recipient.publicId) throw new BadRequestException('Cannot send message to yourself.');

    const attachment = await this.messageMediaStorage.uploadImage(image.buffer, image.mimeType, image.fileName, userId);
    return this.sendMessage(userId, recipientPublicId, content, { attachments: [attachment], replyToId });
  }

  async sendVoiceMessage(userId: string, recipientPublicId: string, voice: UploadedVoice, replyToId?: string) {
    const sender = await this.usersService.findById(userId);
    const recipient = await this.usersService.findByPublicId(recipientPublicId);
    if (!sender || !recipient) throw new NotFoundException('Invalid sender or recipient.');
    if (sender.publicId === recipient.publicId) throw new BadRequestException('Cannot send message to yourself.');

    const attachment = await this.messageMediaStorage.uploadVoice(
      voice.buffer,
      voice.mimeType,
      voice.fileName,
      userId,
      voice.durationMs,
    );
    return this.sendMessage(userId, recipientPublicId, '', { attachments: [attachment], replyToId });
  }

  async sendVideoMessage(userId: string, recipientPublicId: string, video: UploadedVideo, replyToId?: string) {
    await this.ensureCanMessage(userId, recipientPublicId);
    const attachment = await this.messageMediaStorage.uploadVideo(
      video.buffer,
      video.mimeType,
      video.fileName,
      userId,
      video.durationMs,
    );
    return this.sendMessage(userId, recipientPublicId, '', { attachments: [attachment], replyToId });
  }

  async sendFileMessage(userId: string, recipientPublicId: string, file: UploadedFile, replyToId?: string) {
    await this.ensureCanMessage(userId, recipientPublicId);
    const attachment = await this.messageMediaStorage.uploadFile(file.buffer, file.mimeType, file.fileName, userId);
    return this.sendMessage(userId, recipientPublicId, '', { attachments: [attachment], replyToId });
  }

  async sendMessage(userId: string, recipientPublicId: string, content: string, options: SendMessageOptions = {}) {
    const { attachments = [], replyToId } = options;
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
          if (replyToId) {
            const replyTarget = await tx.message.findFirst({
              where: {
                id: replyToId,
                roomId: existingRoom.id,
                deletedAt: { isSet: false },
              },
              select: { id: true },
            });
            if (!replyTarget) throw new BadRequestException('Reply target is not available in this conversation.');
          }

          const message = await tx.message.create({
            data: {
              roomId: existingRoom.id,
              senderId: sender.id,
              content,
              replyToId,
              attachments: attachments?.length ? (attachments as Prisma.InputJsonValue) : undefined,
              receipts: { create: { userId: recipient.id } },
            },
            select: { id: true, content: true, attachments: true, replyToId: true, createdAt: true },
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
          if (replyToId) throw new BadRequestException('Reply target is not available in this conversation.');

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
            select: { id: true, content: true, attachments: true, replyToId: true, createdAt: true },
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
      replyToId: message.replyToId,
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

  async getMessageMedia(userId: string, messageId: string, fileId: string) {
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        deletedAt: { isSet: false },
        room: { members: { some: { userId } } },
      },
      select: { attachments: true },
    });

    const attachment = this.getMediaAttachments(message?.attachments).find((item) => item.fileId === fileId);
    if (!attachment) throw new NotFoundException('Message media not found.');

    const file = await this.messageMediaStorage.find(fileId);
    if (!file) throw new NotFoundException('Message media not found.');

    return { file, attachment };
  }

  openMessageImage(fileId: string) {
    return this.messageMediaStorage.openDownloadStream(fileId);
  }

  openMessageMedia(fileId: string) {
    return this.messageMediaStorage.openDownloadStream(fileId);
  }

  async editMessage(userId: string, messageId: string, content: string) {
    const normalizedContent = content.trim();
    if (!normalizedContent) {
      throw new BadRequestException('Message content cannot be empty.');
    }

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
      data: { content: normalizedContent, editedAt: new Date() },
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
    const result = await this.prisma.$transaction(async (tx) => {
      const existingMessage = await tx.message.findFirst({
        where: {
          id: messageId,
          senderId: userId,
          deletedAt: { isSet: false },
        },
        select: {
          id: true,
          roomId: true,
          attachments: true,
          receipts: {
            select: {
              userId: true,
              readAt: true,
            },
          },
          room: {
            select: {
              dmKey: true,
              lastMessageId: true,
            },
          },
          sender: {
            select: {
              publicId: true,
            },
          },
        },
      });

      if (!existingMessage) {
        throw new NotFoundException('Message not found or you do not have permission to delete it.');
      }

      const deletedAt = new Date();
      await tx.message.update({
        where: { id: messageId },
        data: { deletedAt },
      });

      if (existingMessage.room.lastMessageId === messageId) {
        const previousMessage = await tx.message.findFirst({
          where: {
            roomId: existingMessage.roomId,
            id: { not: messageId },
            deletedAt: { isSet: false },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });

        await tx.room.update({
          where: { id: existingMessage.roomId },
          data: { lastMessageId: previousMessage?.id ?? null },
        });
      }

      const unreadReceipt = existingMessage.receipts.find((receipt) => !receipt.readAt);
      if (unreadReceipt) {
        await tx.roomMember.updateMany({
          where: {
            roomId: existingMessage.roomId,
            userId: unreadReceipt.userId,
            unreadCount: { gt: 0 },
          },
          data: {
            unreadCount: { decrement: 1 },
          },
        });
      }

      return {
        id: existingMessage.id,
        attachments: existingMessage.attachments,
        dmKey: existingMessage.room.dmKey as string,
        senderPublicId: existingMessage.sender.publicId,
        deletedAt,
      };
    });

    await Promise.allSettled(
      this.getMediaAttachments(result.attachments).map((attachment) =>
        this.messageMediaStorage.delete(attachment.fileId),
      ),
    );

    const recipientPublicId = this.getPartnerPublicKey(result.senderPublicId, result.dmKey);

    this.eventEmitter.emit('message.deleted', {
      messageId: result.id,
      dmKey: result.dmKey,
      deletedByPublicId: result.senderPublicId,
      recipientPublicId,
      deletedAt: result.deletedAt,
    });

    return {
      success: true,
      messageId: result.id,
      deletedAt: result.deletedAt,
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

  private async ensureCanMessage(userId: string, recipientPublicId: string) {
    const sender = await this.usersService.findById(userId);
    const recipient = await this.usersService.findByPublicId(recipientPublicId);
    if (!sender || !recipient) throw new NotFoundException('Invalid sender or recipient.');
    if (sender.publicId === recipient.publicId) throw new BadRequestException('Cannot send message to yourself.');
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

  private readonly chatProfileUserSelect = {
    omit: {
      id: true,
      passwordHash: true,
      lastLoginAt: true,
      roles: true,
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
      replyTo: {
        select: {
          id: true,
          content: true,
          attachments: true,
          deletedAt: true,
          sender: {
            select: {
              firstName: true,
              lastName: true,
              publicId: true,
            },
          },
        },
      },
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

  private dmRoomDetailsSelectForUser(userId: string) {
    return {
      ...this.dmRoomSelectForUser(userId),
      members: {
        where: {
          userId: { not: userId },
        },
        select: {
          user: this.chatProfileUserSelect,
        },
      },
    } as const;
  }

  private getImageAttachments(value: Prisma.JsonValue | null | undefined): ImageMessageAttachment[] {
    return this.getMediaAttachments(value).filter(
      (attachment): attachment is ImageMessageAttachment => attachment.type === 'IMAGE',
    );
  }

  private getMediaAttachments(value: Prisma.JsonValue | null | undefined): MessageMediaAttachment[] {
    if (!Array.isArray(value)) return [];

    return value.filter((item): item is MessageMediaAttachment => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const commonFieldsAreValid =
        typeof item.fileId === 'string' &&
        typeof item.fileName === 'string' &&
        typeof item.mimeType === 'string' &&
        typeof item.size === 'number';

      return (
        commonFieldsAreValid &&
        (item.type === 'IMAGE' ||
          item.type === 'FILE' ||
          (item.type === 'VOICE' && typeof item.durationMs === 'number') ||
          (item.type === 'VIDEO' && (item.durationMs === undefined || typeof item.durationMs === 'number')))
      );
    });
  }
}

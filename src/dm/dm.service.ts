import { ForbiddenException, Injectable } from '@nestjs/common';
import { RoomType } from 'generated/prisma/enums';
import { UsersService } from 'src/users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { SeenAllMessagesDto, SeenMessageDto, SendMessageDto } from './dto';

@Injectable()
export class DmService {
  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
  ) {}

  async sendMessage(userId: string, dto: SendMessageDto) {
    const { recipientPublicId, content } = dto;

    const sender = await this.usersService.findById(userId);
    const recipient = await this.usersService.findByPublicId(recipientPublicId);

    if (!sender || !recipient) {
      throw new ForbiddenException('Invalid sender or recipient.');
    }

    const dmKey = this.makeDmKey(sender.publicId, recipient.publicId);

    const existingRoom = await this.prisma.room.findUnique({
      where: { type_dmKey: { type: RoomType.DM, dmKey } },
    });

    await this.usersService.updateLastActivity(sender.id);

    if (existingRoom) {
      const message = await this.prisma.$transaction(async (tx) => {
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
      });

      return {
        messageId: message.id,
        content: message.content,
        createdAt: message.createdAt,
        dmKey,
      };
    } else {
      const message = await this.prisma.$transaction(async (tx) => {
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
      });

      return {
        messageId: message.id,
        content: message.content,
        createdAt: message.createdAt,
        dmKey,
      };
    }
  }

  async seenMessage(userId: string, dto: SeenMessageDto) {
    const { messageId } = dto;

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
        },
        select: { readAt: true },
      });

      if (!receipt) {
        throw new ForbiddenException('Message receipt not found.');
      }

      if (!receipt.readAt) {
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
      }
    });
  }

  async seenAllMessages(userId: string, dto: SeenAllMessagesDto) {
    const { dmKey } = dto;

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

  private makeDmKey(a: string, b: string): string {
    return [a, b].sort().join('~');
  }

  private parseDmKey(dmKey: string): [string, string] {
    const parts = dmKey.split('~');
    if (parts.length !== 2) throw new Error('Invalid dmKey format');
    return parts as [string, string];
  }
}

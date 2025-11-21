import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { JwtPayload } from 'src/api/v1/auth/types';
import { UsersService } from 'src/api/v1/users/users.service';
import { appLogger } from 'src/logger/winston.logger';
import type {
  AuthenticatedSocket,
  MessageDeletedEventData,
  MessageDeletedPayload,
  MessageEditedEventData,
  MessageEditedPayload,
  MessageNewEventData,
  MessageNewPayload,
  MessageSeenAllEventData,
  MessageSeenAllPayload,
  MessagesSeenEventData,
  MessagesSeenPayload,
  TypingStartEventData,
  TypingStartPayload,
  UserProfileUpdatedPayload,
  UserStatusPayload,
} from './types';

@Injectable()
@WebSocketGateway({
  namespace: '/events',
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) || [],
  },
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly userSockets = new Map<string, Set<string>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  afterInit(_server: Server) {
    appLogger.info('WebSocket Gateway initialized', { context: 'EventsGateway' });
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = this.extractTokenFromHandshake(client);
      if (!token) {
        appLogger.warn(`Client ${client.id} connection rejected: No token provided`, { context: 'EventsGateway' });
        client.disconnect();
        return;
      }

      const payload = await this.verifyToken(token);
      if (!payload) {
        appLogger.warn(`Client ${client.id} connection rejected: Invalid token`, { context: 'EventsGateway' });
        client.disconnect();
        return;
      }

      const user = await this.usersService.findById(payload.sub);
      if (!user) {
        appLogger.warn(`Client ${client.id} connection rejected: User not found`, { context: 'EventsGateway' });
        client.disconnect();
        return;
      }

      client.userId = user.id;
      client.publicId = user.publicId;

      if (!this.userSockets.has(user.id)) {
        this.userSockets.set(user.id, new Set());
      }
      this.userSockets.get(user.id)!.add(client.id);

      await client.join(`user:${user.publicId}`);

      appLogger.info(`Client ${client.id} connected as (user ${user.publicId})`, { context: 'EventsGateway' });

      await this.usersService.updateLastActivity(user.id);

      const statusPayload: UserStatusPayload = {
        publicId: user.publicId,
        status: 'ONLINE',
        lastActiveAt: new Date(),
      };

      client.broadcast.emit('user:status', statusPayload);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      appLogger.error(`Error handling connection: ${errorMessage}`, { context: 'EventsGateway' });
      client.disconnect();
    }

    console.log('userSockets:', this.userSockets);
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (!client.userId) return;

    const userSocketSet = this.userSockets.get(client.userId);
    if (userSocketSet) {
      userSocketSet.delete(client.id);

      const isLastSession = userSocketSet.size === 0;

      if (isLastSession) {
        this.userSockets.delete(client.userId);

        const statusPayload: UserStatusPayload = {
          publicId: client.publicId!,
          status: 'OFFLINE',
          lastActiveAt: new Date(),
        };

        this.server.emit('user:status', statusPayload);
      }

      await this.usersService.updateLastActivity(client.userId, isLastSession ? 'OFFLINE' : undefined);
    }

    appLogger.info(`Client ${client.id} disconnected (user: ${client.publicId})`, { context: 'EventsGateway' });
    console.log('userSockets:', this.userSockets);
  }

  @SubscribeMessage('ping')
  handlePing(_client: AuthenticatedSocket) {
    return { event: 'pong', data: { timestamp: new Date() } };
  }

  @OnEvent('message.new')
  handleNewMessage({ recipientPublicId, ...data }: MessageNewPayload) {
    this.emitToUsers<MessageNewEventData>([recipientPublicId, data.senderPublicId], 'message:new', data);

    appLogger.debug(`Emitting new message event to ${recipientPublicId}`, { context: 'EventsGateway' });
  }

  @OnEvent('message.edited')
  handleEditedMessage({ recipientPublicId, ...data }: MessageEditedPayload) {
    this.emitToUsers<MessageEditedEventData>([recipientPublicId, data.editorPublicId], 'message:edited', data);

    appLogger.debug(`Emitting message edited event for ${recipientPublicId}`, { context: 'EventsGateway' });
  }

  @OnEvent('message.deleted')
  handleDeletedMessage({ recipientPublicId, ...data }: MessageDeletedPayload) {
    this.emitToUsers<MessageDeletedEventData>([recipientPublicId, data.deletedByPublicId], 'message:deleted', data);

    appLogger.debug(`Emitting message deleted event for ${recipientPublicId}`, { context: 'EventsGateway' });
  }

  @OnEvent('messages.seen')
  handleMessageSeen({ recipientPublicId, ...data }: MessagesSeenPayload) {
    this.emitToUsers<MessagesSeenEventData>([recipientPublicId, data.seenByPublicId], 'messages:seen', data);

    appLogger.debug(`Emitting message seen event for ${recipientPublicId}`, { context: 'EventsGateway' });
  }

  @OnEvent('message.seen.all')
  handleMessageSeenAll({ recipientPublicId, ...data }: MessageSeenAllPayload) {
    this.emitToUsers<MessageSeenAllEventData>([recipientPublicId, data.seenAllByPublicId], 'message:seen-all', data);

    appLogger.debug(`Emitting message seen all event for ${recipientPublicId}`, { context: 'EventsGateway' });
  }

  @OnEvent('typing.start')
  handleTypingStart({ recipientPublicId, ...data }: TypingStartPayload) {
    appLogger.debug(`${data.userPublicId} is typing to ${recipientPublicId}`, { context: 'EventsGateway' });

    this.emitToUser<TypingStartEventData>(recipientPublicId, 'typing:start', data);
  }

  @OnEvent('user.status')
  handleUserStatus(payload: UserStatusPayload) {
    appLogger.debug(`User ${payload.publicId} status: ${payload.status}`, { context: 'EventsGateway' });

    this.server.emit('user:status', payload);
  }

  @OnEvent('user.profile.updated')
  handleProfileUpdated(payload: UserProfileUpdatedPayload) {
    appLogger.debug(`User ${payload.publicId} updated profile: ${payload.updatedFields.join(', ')}`, {
      context: 'EventsGateway',
    });

    this.server.emit('user:profile-updated', payload);
  }

  private extractTokenFromHandshake(client: Socket): string | undefined {
    const auth = client.handshake.auth;
    if (auth?.token && typeof auth.token === 'string') {
      return auth.token;
    }

    const queryToken = client.handshake.query?.token;
    if (typeof queryToken === 'string') {
      return queryToken;
    }

    const authHeader = client.handshake.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
  }

  private async verifyToken(token: string) {
    try {
      const payload: JwtPayload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
      });

      return payload;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      appLogger.error(`Token verification failed: ${errorMessage}`, { context: 'EventsGateway' });
      return null;
    }
  }

  private emitToUser<T>(publicId: string, event: string, data: T): void {
    this.server.to(`user:${publicId}`).emit(event, data);
  }

  private emitToUsers<T>(publicIds: string[], event: string, data: T): void {
    const rooms = publicIds.map((id) => `user:${id}`);
    this.server.to(rooms).emit(event, data);
  }

  getConnectedUsersCount(): number {
    return this.userSockets.size;
  }

  isUserOnline(userId: string): boolean {
    return this.userSockets.has(userId);
  }
}

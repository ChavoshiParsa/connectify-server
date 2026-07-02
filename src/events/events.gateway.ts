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
import { UserStatus } from 'generated/prisma/enums';
import { Server, Socket } from 'socket.io';
import type { JwtPayload } from 'src/api/v1/auth/types';
import { UsersService } from 'src/api/v1/users/users.service';
import { appLogger } from 'src/logger/pino.logger';
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

const OFFLINE_GRACE_MS = 10_000;

@Injectable()
@WebSocketGateway({
  namespace: '/events',
  cors: {
    origin:
      process.env.ALLOWED_ORIGINS?.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean) || [],
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly userSockets = new Map<string, Set<string>>();
  private readonly offlineTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  afterInit(_server: Server) {
    appLogger.info('WebSocket gateway initialized', { context: 'EventsGateway' });
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = this.extractTokenFromHandshake(client);
      if (!token) {
        appLogger.warn(`Client ${client.id} connection rejected: no token`, { context: 'EventsGateway' });
        client.disconnect(true);
        return;
      }

      const payload = await this.verifyToken(token);
      if (!payload) {
        appLogger.warn(`Client ${client.id} connection rejected: invalid token`, { context: 'EventsGateway' });
        client.disconnect(true);
        return;
      }

      const user = await this.usersService.findById(payload.sub);
      if (!user) {
        appLogger.warn(`Client ${client.id} connection rejected: user not found`, { context: 'EventsGateway' });
        client.disconnect(true);
        return;
      }

      client.userId = user.id;
      client.publicId = user.publicId;

      this.cancelOfflineTimer(user.id);
      this.addUserSocket(user.id, client.id);

      await client.join(`user:${user.publicId}`);
      await this.usersService.updateLastActivity(user.id, UserStatus.ONLINE);

      appLogger.info(`Client connected`, {
        context: 'EventsGateway',
        socketId: client.id,
        userId: user.id,
        publicId: user.publicId,
        activeSockets: this.getUserSocketCount(user.id),
      });
    } catch (error) {
      appLogger.error('Error handling socket connection', {
        context: 'EventsGateway',
        socketId: client.id,
        err: error instanceof Error ? error : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (!client.userId) {
      appLogger.warn(`Client disconnected without userId`, {
        context: 'EventsGateway',
        socketId: client.id,
      });
      return;
    }

    const remainingSockets = this.removeUserSocket(client.userId, client.id);

    if (remainingSockets === 0) {
      this.scheduleOffline(client.userId);
    } else {
      await this.usersService.updateLastActivity(client.userId, UserStatus.ONLINE);
    }

    appLogger.info('Client disconnected', {
      context: 'EventsGateway',
      socketId: client.id,
      userId: client.userId,
      publicId: client.publicId,
      remainingSockets,
    });
  }

  @SubscribeMessage('ping')
  handlePing(_client: AuthenticatedSocket) {
    return { event: 'pong', data: { timestamp: new Date() } };
  }

  @OnEvent('message.new')
  handleNewMessage({ recipientPublicId, ...data }: MessageNewPayload) {
    this.emitToUsers<MessageNewEventData>([recipientPublicId, data.senderPublicId], 'message:new', data);

    appLogger.debug(`Emitting new message event`, { context: 'EventsGateway', recipientPublicId });
  }

  @OnEvent('message.edited')
  handleEditedMessage({ recipientPublicId, ...data }: MessageEditedPayload) {
    this.emitToUsers<MessageEditedEventData>([recipientPublicId, data.editorPublicId], 'message:edited', data);

    appLogger.debug(`Emitting message edited event`, { context: 'EventsGateway', recipientPublicId });
  }

  @OnEvent('message.deleted')
  handleDeletedMessage({ recipientPublicId, ...data }: MessageDeletedPayload) {
    this.emitToUsers<MessageDeletedEventData>([recipientPublicId, data.deletedByPublicId], 'message:deleted', data);

    appLogger.debug(`Emitting message deleted event`, { context: 'EventsGateway', recipientPublicId });
  }

  @OnEvent('messages.seen')
  handleMessageSeen({ recipientPublicId, ...data }: MessagesSeenPayload) {
    this.emitToUsers<MessagesSeenEventData>([recipientPublicId, data.seenByPublicId], 'messages:seen', data);

    appLogger.debug(`Emitting messages seen event`, { context: 'EventsGateway', recipientPublicId });
  }

  @OnEvent('message.seen.all')
  handleMessageSeenAll({ recipientPublicId, ...data }: MessageSeenAllPayload) {
    this.emitToUsers<MessageSeenAllEventData>([recipientPublicId, data.seenAllByPublicId], 'message:seen-all', data);

    appLogger.debug(`Emitting message seen all event`, { context: 'EventsGateway', recipientPublicId });
  }

  @OnEvent('typing.start')
  handleTypingStart({ recipientPublicId, ...data }: TypingStartPayload) {
    appLogger.debug('Emitting typing start event', {
      context: 'EventsGateway',
      userPublicId: data.userPublicId,
      recipientPublicId,
    });

    this.emitToUser<TypingStartEventData>(recipientPublicId, 'typing:start', data);
  }

  @OnEvent('user.status')
  handleUserStatus(payload: UserStatusPayload) {
    appLogger.debug('Broadcasting user status', {
      context: 'EventsGateway',
      publicId: payload.publicId,
      status: payload.status,
    });

    this.server.emit('user:status', payload);
  }

  @OnEvent('user.profile.updated')
  handleProfileUpdated(payload: UserProfileUpdatedPayload) {
    appLogger.debug('Broadcasting profile update', {
      context: 'EventsGateway',
      publicId: payload.publicId,
      updatedFields: payload.updatedFields,
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
      appLogger.warn('Socket token verification failed', {
        context: 'EventsGateway',
        err: error instanceof Error ? error : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
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

  private addUserSocket(userId: string, socketId: string) {
    const sockets = this.userSockets.get(userId) ?? new Set<string>();
    sockets.add(socketId);
    this.userSockets.set(userId, sockets);
  }

  private removeUserSocket(userId: string, socketId: string) {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return 0;

    sockets.delete(socketId);

    if (sockets.size === 0) {
      this.userSockets.delete(userId);
      return 0;
    }

    return sockets.size;
  }

  private getUserSocketCount(userId: string) {
    return this.userSockets.get(userId)?.size ?? 0;
  }

  private scheduleOffline(userId: string) {
    this.cancelOfflineTimer(userId);

    const timer = setTimeout(() => {
      void this.markOfflineIfStillDisconnected(userId);
    }, OFFLINE_GRACE_MS);

    this.offlineTimers.set(userId, timer);
  }

  private cancelOfflineTimer(userId: string) {
    const timer = this.offlineTimers.get(userId);
    if (!timer) return;

    clearTimeout(timer);
    this.offlineTimers.delete(userId);
  }

  private async markOfflineIfStillDisconnected(userId: string) {
    this.offlineTimers.delete(userId);

    if (this.userSockets.has(userId)) return;

    await this.usersService.updateLastActivity(userId, UserStatus.OFFLINE);

    appLogger.info('User marked offline after disconnect grace period', {
      context: 'EventsGateway',
      userId,
    });
  }

  getConnectedUsersCount(): number {
    return this.userSockets.size;
  }

  isUserOnline(userId: string): boolean {
    return this.userSockets.has(userId);
  }
}

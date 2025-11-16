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
import { JwtPayload } from 'src/api/v1/auth/types/jwt-payload.interface';
import { UsersService } from 'src/api/v1/users/users.service';
import { appLogger } from 'src/logger/winston.logger';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  publicId?: string;
}

@Injectable()
@WebSocketGateway({
  namespace: '/events',
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) || [],
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly userSockets = new Map<string, Set<string>>();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private usersService: UsersService,
  ) {}

  afterInit(_server: Server) {
    appLogger.info('WebSocket Gateway initialized', { context: EventsGateway.name });
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = this.extractTokenFromHandshake(client);
      if (!token) {
        appLogger.warn(`Client ${client.id} connection rejected: No token provided`, { context: EventsGateway.name });
        client.disconnect();
        return;
      }

      const payload = await this.verifyToken(token);
      if (!payload) {
        appLogger.warn(`Client ${client.id} connection rejected: Invalid token`, { context: EventsGateway.name });
        client.disconnect();
        return;
      }

      const user = await this.usersService.findById(payload.sub);
      if (!user) {
        appLogger.warn(`Client ${client.id} connection rejected: User not found`, { context: EventsGateway.name });
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

      appLogger.info(`Client ${client.id} connected as user ${user.publicId}`, { context: EventsGateway.name });

      await this.usersService.updateLastActivity(user.id);

      client.broadcast.emit('user:status', {
        publicId: user.publicId,
        status: 'ONLINE',
        lastActiveAt: new Date(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      appLogger.error(`Error handling connection: ${errorMessage}`, { context: EventsGateway.name });
      client.disconnect();
    } finally {
      // console.log('user socket:', this.userSockets);
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (!client.userId) return;

    const userSocketSet = this.userSockets.get(client.userId);
    if (userSocketSet) {
      userSocketSet.delete(client.id);

      if (userSocketSet.size === 0) {
        this.userSockets.delete(client.userId);

        this.server.emit('user:status', {
          publicId: client.publicId,
          status: 'OFFLINE',
          lastActiveAt: new Date(),
        });
      }
      await this.usersService.updateLastActivity(client.userId, userSocketSet.size === 0 ? 'OFFLINE' : undefined);
    }

    appLogger.info(`Client ${client.id} disconnected (user: ${client.publicId})`, { context: EventsGateway.name });

    // console.log('user socket:', this.userSockets);
  }

  @SubscribeMessage('ping')
  handlePing(_client: AuthenticatedSocket) {
    return { event: 'pong', data: { timestamp: new Date() } };
  }

  @OnEvent('message.new')
  handleNewMessage(payload: {
    messageId: string;
    dmKey: string;
    senderPublicId: string;
    recipientPublicId: string;
    createdAt: Date;
  }) {
    appLogger.debug(`Emitting new message event to ${payload.recipientPublicId}`, { context: EventsGateway.name });

    this.server.to(`user:${payload.recipientPublicId}`).emit('message:new', {
      messageId: payload.messageId,
      dmKey: payload.dmKey,
      senderPublicId: payload.senderPublicId,
      createdAt: payload.createdAt,
    });
  }

  @OnEvent('message.edited')
  handleEditedMessage(payload: {
    messageId: string;
    dmKey: string;
    editorPublicId: string;
    recipientPublicId: string;
    editedAt: Date;
  }) {
    appLogger.debug(`Emitting message edited event for ${payload.recipientPublicId}`, { context: EventsGateway.name });

    this.server.to(`user:${payload.recipientPublicId}`).emit('message:edited', {
      messageId: payload.messageId,
      dmKey: payload.dmKey,
      editorPublicId: payload.editorPublicId,
      editedAt: payload.editedAt,
    });
  }

  @OnEvent('message.deleted')
  handleDeletedMessage(payload: {
    messageId: string;
    dmKey: string;
    deletedByPublicId: string;
    recipientPublicId: string;
    deletedAt: Date;
  }) {
    appLogger.debug(`Emitting message deleted event for ${payload.recipientPublicId}`, { context: EventsGateway.name });

    this.server.to(`user:${payload.recipientPublicId}`).emit('message:deleted', {
      messageId: payload.messageId,
      dmKey: payload.dmKey,
      deletedByPublicId: payload.deletedByPublicId,
      deletedAt: payload.deletedAt,
    });
  }

  @OnEvent('message.seen')
  handleMessageSeen(payload: {
    messageId: string;
    dmKey: string;
    seenByPublicId: string;
    recipientPublicId: string;
    readAt: Date;
  }) {
    appLogger.debug(`Emitting message seen event for ${payload.recipientPublicId}`, { context: EventsGateway.name });

    this.server.to(`user:${payload.recipientPublicId}`).emit('message:seen', {
      messageId: payload.messageId,
      dmKey: payload.dmKey,
      seenByPublicId: payload.seenByPublicId,
      readAt: payload.readAt,
    });
  }

  @OnEvent('message.seen.all')
  handleMessageSeenAll(payload: { dmKey: string; seenAllByPublicId: string; recipientPublicId: string; readAt: Date }) {
    appLogger.debug(`Emitting message seen all event for ${payload.recipientPublicId}`, {
      context: EventsGateway.name,
    });

    this.server.to(`user:${payload.recipientPublicId}`).emit('message:seen-all', {
      dmKey: payload.dmKey,
      seenAllByPublicId: payload.seenAllByPublicId,
      readAt: payload.readAt,
    });
  }

  @OnEvent('typing.start')
  handleTypingStart(payload: { dmKey: string; userPublicId: string; recipientPublicId: string }) {
    appLogger.debug(`${payload.userPublicId} is typing to ${payload.recipientPublicId}`, {
      context: EventsGateway.name,
    });

    this.server.to(`user:${payload.recipientPublicId}`).emit('typing:start', {
      dmKey: payload.dmKey,
      userPublicId: payload.userPublicId,
    });
  }

  @OnEvent('user.status')
  handleUserStatus(payload: { publicId: string; status: 'ONLINE' | 'OFFLINE'; lastActiveAt: Date }) {
    appLogger.debug(`User ${payload.publicId} status: ${payload.status}`, { context: EventsGateway.name });

    this.server.emit('user:status', {
      publicId: payload.publicId,
      status: payload.status,
      lastActiveAt: payload.lastActiveAt,
    });
  }

  @OnEvent('user.profile.updated')
  handleProfileUpdated(payload: { publicId: string; updatedFields: string[] }) {
    appLogger.debug(`User ${payload.publicId} updated profile: ${payload.updatedFields.join(', ')}`, {
      context: EventsGateway.name,
    });

    this.server.emit('user:profile-updated', {
      publicId: payload.publicId,
      updatedFields: payload.updatedFields,
    });
  }

  private extractTokenFromHandshake(client: Socket): string | null {
    const authHeader = client.handshake.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    return null;
  }

  private async verifyToken(token: string) {
    try {
      const payload: JwtPayload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
      });

      return payload;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      appLogger.error(`Token verification failed: ${errorMessage}`, { context: EventsGateway.name });
      return null;
    }
  }

  getConnectedUsersCount(): number {
    return this.userSockets.size;
  }

  isUserOnline(userId: string): boolean {
    return this.userSockets.has(userId);
  }
}

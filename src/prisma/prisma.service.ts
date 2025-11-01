import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from 'generated/prisma/client';
import { appLogger } from '../logger/winston.logger';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit() {
    await this.$connect();
    appLogger.info('Connected to database', { context: 'PrismaService' });

    this.$on('query' as never, (e: Prisma.QueryEvent) => {
      appLogger.debug(e.query, {
        context: 'PrismaQuery',
        params: e.params,
        durationMs: e.duration,
      });
    });

    this.$on('info' as never, (e: Prisma.LogEvent) => {
      appLogger.info(e.message, { context: 'Prisma' });
    });

    this.$on('warn' as never, (e: Prisma.LogEvent) => {
      appLogger.warn(e.message, { context: 'Prisma' });
    });

    this.$on('error' as never, (e: Prisma.LogEvent) => {
      appLogger.error(`Prisma error: ${e.message}`, { context: 'Prisma' });
    });

    try {
      await this.$runCommandRaw({
        createIndexes: 'Session',
        indexes: [
          {
            key: { expiresAt: 1 },
            name: 'Session_expiresAt_ttl',
            expireAfterSeconds: 0,
          },
        ],
      });
      appLogger.info('TTL index ensured on Session.expiresAt', { context: 'PrismaService' });
    } catch (err) {
      if (err && typeof err === 'object') {
        const code = (err as { code?: string }).code;
        const metaMessage = (err as { meta?: { message?: string } }).meta?.message;
        const message = (err as { message?: string }).message;

        const isPrismaP2010 = code === 'P2010';
        const isIndexConflict =
          metaMessage?.includes('IndexOptionsConflict') || message?.includes('IndexOptionsConflict');

        if (isPrismaP2010 && isIndexConflict) {
          return;
        }
      }

      throw err;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    appLogger.info('Disconnected from database', { context: 'PrismaService' });
  }
}

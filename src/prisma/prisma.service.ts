import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from 'generated/prisma/client';

import { appLogger } from '../logger/pino.logger';

type MongoIndexSpec = {
  name?: string;
  key?: Record<string, number>;
  expireAfterSeconds?: number;
};

type MongoListIndexesResult = {
  cursor?: {
    firstBatch?: MongoIndexSpec[];
  };
};

type PrismaRawCommandError = {
  code?: string;
  message?: string;
  meta?: {
    message?: string;
  };
};

const SESSION_COLLECTION = 'Session';
const SESSION_EXPIRES_AT_TTL_INDEX = 'Session_expiresAt_ttl';
const SESSION_EXPIRES_AT_PRISMA_INDEX = 'Session_expiresAt_idx';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private static sessionTtlIndexPromise: Promise<void> | null = null;

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });

    this.registerPrismaLogListeners();
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();

    appLogger.info('Connected to database', {
      context: 'PrismaService',
    });

    await this.ensureSessionTtlIndexOnce();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();

    appLogger.info('Disconnected from database', {
      context: 'PrismaService',
    });
  }

  private registerPrismaLogListeners(): void {
    this.$on('query' as never, (event: Prisma.QueryEvent) => {
      appLogger.debug(event.query, {
        context: 'PrismaQuery',
        params: event.params,
        durationMs: event.duration,
      });
    });

    this.$on('info' as never, (event: Prisma.LogEvent) => {
      appLogger.info(event.message, {
        context: 'Prisma',
      });
    });

    this.$on('warn' as never, (event: Prisma.LogEvent) => {
      appLogger.warn(event.message, {
        context: 'Prisma',
      });
    });

    this.$on('error' as never, (event: Prisma.LogEvent) => {
      appLogger.error(`Prisma error: ${event.message}`, {
        context: 'Prisma',
      });
    });
  }

  private async ensureSessionTtlIndexOnce(): Promise<void> {
    PrismaService.sessionTtlIndexPromise ??= this.ensureSessionTtlIndex();

    await PrismaService.sessionTtlIndexPromise;
  }

  private async ensureSessionTtlIndex(): Promise<void> {
    const indexes = await this.getCollectionIndexes(SESSION_COLLECTION);

    const expectedTtlIndex = indexes.find((index) => this.isExpectedSessionTtlIndex(index));

    if (expectedTtlIndex) {
      appLogger.info('TTL index already exists on Session.expiresAt', {
        context: 'PrismaService',
        indexName: expectedTtlIndex.name,
      });

      return;
    }

    const conflictingIndex = indexes.find((index) => this.isConflictingExpiresAtIndex(index));

    if (conflictingIndex?.name) {
      await this.dropIndex(SESSION_COLLECTION, conflictingIndex.name);
    }

    await this.createSessionTtlIndex();

    appLogger.info('TTL index ensured on Session.expiresAt', {
      context: 'PrismaService',
      indexName: SESSION_EXPIRES_AT_TTL_INDEX,
    });
  }

  private async getCollectionIndexes(collectionName: string): Promise<MongoIndexSpec[]> {
    try {
      const result = (await this.$runCommandRaw({
        listIndexes: collectionName,
      })) as MongoListIndexesResult;

      return result.cursor?.firstBatch ?? [];
    } catch (error: unknown) {
      if (this.isNamespaceNotFoundError(error)) {
        return [];
      }

      throw error;
    }
  }

  private async dropIndex(collectionName: string, indexName: string): Promise<void> {
    appLogger.warn(`Dropping conflicting MongoDB index: ${indexName}`, {
      context: 'PrismaService',
      collectionName,
      indexName,
    });

    await this.$runCommandRaw({
      dropIndexes: collectionName,
      index: indexName,
    });
  }

  private async createSessionTtlIndex(): Promise<void> {
    await this.$runCommandRaw({
      createIndexes: SESSION_COLLECTION,
      indexes: [
        {
          key: { expiresAt: 1 },
          name: SESSION_EXPIRES_AT_TTL_INDEX,
          expireAfterSeconds: 0,
        },
      ],
    });
  }

  private isExpectedSessionTtlIndex(index: MongoIndexSpec): boolean {
    return index.name === SESSION_EXPIRES_AT_TTL_INDEX && index.key?.expiresAt === 1 && index.expireAfterSeconds === 0;
  }

  private isConflictingExpiresAtIndex(index: MongoIndexSpec): boolean {
    const isSingleFieldExpiresAtIndex = index.key?.expiresAt === 1 && Object.keys(index.key).length === 1;

    if (!isSingleFieldExpiresAtIndex) {
      return false;
    }

    return (
      index.name === SESSION_EXPIRES_AT_PRISMA_INDEX ||
      index.name !== SESSION_EXPIRES_AT_TTL_INDEX ||
      index.expireAfterSeconds !== 0
    );
  }

  private isNamespaceNotFoundError(error: unknown): boolean {
    const errorText = this.getErrorText(error);

    return errorText.includes('NamespaceNotFound') || errorText.includes('ns does not exist');
  }

  private getErrorText(error: unknown): string {
    if (!error || typeof error !== 'object') {
      return '';
    }

    const prismaError = error as PrismaRawCommandError;

    return [prismaError.code, prismaError.message, prismaError.meta?.message].filter(Boolean).join(' ');
  }
}

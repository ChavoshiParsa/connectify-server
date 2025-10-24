import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from 'generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();

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
    } catch (err) {
      // Narrow the type safely
      if (err && typeof err === 'object') {
        const code = (err as { code?: string }).code;
        const metaMessage = (err as { meta?: { message?: string } }).meta?.message;
        const message = (err as { message?: string }).message;

        const isPrismaP2010 = code === 'P2010';
        const isIndexConflict =
          metaMessage?.includes('IndexOptionsConflict') || message?.includes('IndexOptionsConflict');

        if (isPrismaP2010 && isIndexConflict) {
          // Ignore index conflict — index already exists
          return;
        }
      }

      // Re-throw any other errors
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

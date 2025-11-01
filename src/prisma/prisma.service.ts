import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from 'generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('✅ Successfully connected to the database');

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
      this.logger.log('✅ TTL index ensured on Session.expiresAt');
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
          // this.logger.warn('⚠️ TTL index already exists, skipping');
          return;
        }
      }

      this.logger.error('❌ Error while creating index', err);
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('🔌 Disconnected from the database');
  }
}

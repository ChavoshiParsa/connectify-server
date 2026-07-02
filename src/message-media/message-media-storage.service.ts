import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GridFSBucket, GridFSFile, MongoClient, ObjectId } from 'mongodb';
import { MAX_MESSAGE_IMAGE_BYTES, MESSAGE_MEDIA_BUCKET_NAME } from './message-media.constants';
import type { ImageMessageAttachment } from './message-media.types';

@Injectable()
export class MessageMediaStorageService implements OnModuleInit, OnModuleDestroy {
  private client?: MongoClient;
  private bucket?: GridFSBucket;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const databaseUrl = this.configService.get<string>('DATABASE_URL');
    if (!databaseUrl) throw new Error('DATABASE_URL is required for message media storage');

    this.client = new MongoClient(databaseUrl);
    await this.client.connect();
    this.bucket = new GridFSBucket(this.client.db(), { bucketName: MESSAGE_MEDIA_BUCKET_NAME });
  }

  async onModuleDestroy() {
    await this.client?.close();
  }

  async uploadImage(
    buffer: Buffer,
    declaredContentType: string,
    originalFileName: string,
    senderId: string,
  ): Promise<ImageMessageAttachment> {
    const mimeType = this.validateImage(buffer, declaredContentType);
    const safeFileName = this.safeFileName(originalFileName, mimeType);
    const upload = this.getBucket().openUploadStream(safeFileName, {
      metadata: { senderId, mimeType, mediaType: 'IMAGE' },
    });

    await new Promise<void>((resolve, reject) => {
      upload.once('finish', resolve);
      upload.once('error', reject);
      upload.end(buffer);
    });

    return {
      type: 'IMAGE',
      fileId: upload.id.toHexString(),
      fileName: safeFileName,
      mimeType,
      size: buffer.length,
    };
  }

  async find(fileId: string): Promise<GridFSFile | null> {
    if (!ObjectId.isValid(fileId)) return null;
    return this.getBucket()
      .find({ _id: new ObjectId(fileId) })
      .next();
  }

  openDownloadStream(fileId: string) {
    return this.getBucket().openDownloadStream(new ObjectId(fileId));
  }

  async delete(fileId: string): Promise<void> {
    if (!ObjectId.isValid(fileId)) return;

    try {
      await this.getBucket().delete(new ObjectId(fileId));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if (!message.includes('FileNotFound')) throw error;
    }
  }

  private validateImage(buffer: Buffer, declaredContentType: string): string {
    if (!buffer.length) throw new BadRequestException('Image is empty');
    if (buffer.length > MAX_MESSAGE_IMAGE_BYTES) throw new BadRequestException('Image is too large');

    const detectedContentType = this.detectImageContentType(buffer);
    if (!detectedContentType) throw new BadRequestException('Invalid image type');

    const normalizedDeclaredType = declaredContentType === 'image/jpg' ? 'image/jpeg' : declaredContentType;
    if (normalizedDeclaredType !== detectedContentType) {
      throw new BadRequestException('Image content does not match its file type');
    }

    return detectedContentType;
  }

  private detectImageContentType(buffer: Buffer): string | null {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return 'image/png';
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }
    if (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return 'image/webp';
    }
    return null;
  }

  private safeFileName(originalFileName: string, mimeType: string): string {
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
    const baseName =
      originalFileName
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 80) || 'image';
    return `${baseName}.${extension}`;
  }

  private getBucket(): GridFSBucket {
    if (!this.bucket) throw new Error('Message media storage is not initialized');
    return this.bucket;
  }
}

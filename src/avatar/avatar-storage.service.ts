import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GridFSBucket, GridFSFile, MongoClient, ObjectId } from 'mongodb';
import { AVATAR_BUCKET_NAME, MAX_AVATAR_BYTES } from './avatar.constants';

const AVATAR_URL_PREFIX = '/api/v1/avatars/';

@Injectable()
export class AvatarStorageService implements OnModuleInit, OnModuleDestroy {
  private client?: MongoClient;
  private bucket?: GridFSBucket;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const databaseUrl = this.configService.get<string>('DATABASE_URL');
    if (!databaseUrl) throw new Error('DATABASE_URL is required for avatar storage');

    this.client = new MongoClient(databaseUrl);
    await this.client.connect();
    this.bucket = new GridFSBucket(this.client.db(), { bucketName: AVATAR_BUCKET_NAME });
  }

  async onModuleDestroy() {
    await this.client?.close();
  }

  decodeDataUrl(dataUrl: string): { buffer: Buffer; contentType: string } {
    const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new BadRequestException('Invalid avatar image');

    const contentType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    this.validateImage(buffer, contentType);
    return { buffer, contentType };
  }

  validateImage(buffer: Buffer, declaredContentType?: string): string {
    if (!buffer.length) throw new BadRequestException('Avatar image is empty');
    if (buffer.length > MAX_AVATAR_BYTES) throw new BadRequestException('Avatar image too large');

    const detectedContentType = this.detectImageContentType(buffer);
    if (!detectedContentType) throw new BadRequestException('Invalid avatar image type');

    const normalizedDeclaredType = declaredContentType === 'image/jpg' ? 'image/jpeg' : declaredContentType;
    if (normalizedDeclaredType && normalizedDeclaredType !== detectedContentType) {
      throw new BadRequestException('Avatar image content does not match its file type');
    }

    return detectedContentType;
  }

  async upload(buffer: Buffer, declaredContentType: string, ownerReference: string): Promise<string> {
    const contentType = this.validateImage(buffer, declaredContentType);
    const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1];
    const uploadStream = this.getBucket().openUploadStream(`avatar-${ownerReference}.${extension}`, {
      metadata: { ownerReference, contentType },
    });

    await new Promise<void>((resolve, reject) => {
      uploadStream.once('finish', resolve);
      uploadStream.once('error', reject);
      uploadStream.end(buffer);
    });

    return `${AVATAR_URL_PREFIX}${uploadStream.id.toHexString()}`;
  }

  async find(id: string): Promise<GridFSFile | null> {
    if (!ObjectId.isValid(id)) return null;
    return this.getBucket()
      .find({ _id: new ObjectId(id) })
      .next();
  }

  openDownloadStream(id: string) {
    return this.getBucket().openDownloadStream(new ObjectId(id));
  }

  async deleteByUrl(url?: string | null): Promise<void> {
    const id = this.idFromUrl(url);
    if (!id) return;

    try {
      await this.getBucket().delete(id);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if (!message.includes('FileNotFound')) throw error;
    }
  }

  private idFromUrl(url?: string | null): ObjectId | null {
    if (!url?.startsWith(AVATAR_URL_PREFIX)) return null;
    const rawId = url.slice(AVATAR_URL_PREFIX.length);
    return ObjectId.isValid(rawId) ? new ObjectId(rawId) : null;
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

  private getBucket(): GridFSBucket {
    if (!this.bucket) throw new Error('Avatar storage is not initialized');
    return this.bucket;
  }
}

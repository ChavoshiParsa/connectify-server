import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GridFSBucket, GridFSFile, MongoClient, ObjectId } from 'mongodb';
import {
  MAX_FILE_MESSAGE_BYTES,
  MAX_MESSAGE_IMAGE_BYTES,
  MAX_VIDEO_MESSAGE_BYTES,
  MAX_VOICE_MESSAGE_BYTES,
  MAX_VOICE_MESSAGE_DURATION_MS,
  MESSAGE_MEDIA_BUCKET_NAME,
} from './message-media.constants';
import type {
  FileMessageAttachment,
  ImageMessageAttachment,
  VideoMessageAttachment,
  VoiceMessageAttachment,
} from './message-media.types';

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

  async uploadVoice(
    buffer: Buffer,
    declaredContentType: string,
    originalFileName: string,
    senderId: string,
    durationMs: number,
  ): Promise<VoiceMessageAttachment> {
    if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > MAX_VOICE_MESSAGE_DURATION_MS) {
      throw new BadRequestException('Invalid voice message duration');
    }

    const mimeType = this.validateAudio(buffer, declaredContentType);
    const safeFileName = this.safeFileName(originalFileName, mimeType, 'voice');
    const upload = this.getBucket().openUploadStream(safeFileName, {
      metadata: { senderId, mimeType, mediaType: 'VOICE', durationMs },
    });

    await new Promise<void>((resolve, reject) => {
      upload.once('finish', resolve);
      upload.once('error', reject);
      upload.end(buffer);
    });

    return {
      type: 'VOICE',
      fileId: upload.id.toHexString(),
      fileName: safeFileName,
      mimeType,
      size: buffer.length,
      durationMs,
    };
  }

  async uploadVideo(
    buffer: Buffer,
    declaredContentType: string,
    originalFileName: string,
    senderId: string,
    durationMs?: number,
  ): Promise<VideoMessageAttachment> {
    if (!buffer.length) throw new BadRequestException('Video is empty');
    if (buffer.length > MAX_VIDEO_MESSAGE_BYTES) throw new BadRequestException('Video is too large');

    const normalizedType = declaredContentType.split(';')[0].trim().toLowerCase();
    const isWebm = buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    const isIsoMedia = buffer.length >= 8 && buffer.toString('ascii', 4, 8) === 'ftyp';
    const mimeType =
      isWebm && normalizedType === 'video/webm'
        ? 'video/webm'
        : isIsoMedia && ['video/mp4', 'video/quicktime'].includes(normalizedType)
          ? normalizedType
          : null;
    if (!mimeType) throw new BadRequestException('Invalid video type');

    const safeFileName = this.safeFileName(originalFileName, mimeType, 'video');
    const upload = this.getBucket().openUploadStream(safeFileName, {
      metadata: { senderId, mimeType, mediaType: 'VIDEO', durationMs },
    });
    await new Promise<void>((resolve, reject) => {
      upload.once('finish', resolve);
      upload.once('error', reject);
      upload.end(buffer);
    });

    return {
      type: 'VIDEO',
      fileId: upload.id.toHexString(),
      fileName: safeFileName,
      mimeType,
      size: buffer.length,
      durationMs,
    };
  }

  async uploadFile(
    buffer: Buffer,
    declaredContentType: string,
    originalFileName: string,
    senderId: string,
  ): Promise<FileMessageAttachment> {
    if (!buffer.length) throw new BadRequestException('File is empty');
    if (buffer.length > MAX_FILE_MESSAGE_BYTES) throw new BadRequestException('File is too large');

    const mimeType = declaredContentType.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
    const safeFileName = this.safeGenericFileName(originalFileName);
    const upload = this.getBucket().openUploadStream(safeFileName, {
      metadata: { senderId, mimeType, mediaType: 'FILE' },
    });
    await new Promise<void>((resolve, reject) => {
      upload.once('finish', resolve);
      upload.once('error', reject);
      upload.end(buffer);
    });

    return { type: 'FILE', fileId: upload.id.toHexString(), fileName: safeFileName, mimeType, size: buffer.length };
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

  private validateAudio(buffer: Buffer, declaredContentType: string): string {
    if (!buffer.length) throw new BadRequestException('Voice message is empty');
    if (buffer.length > MAX_VOICE_MESSAGE_BYTES) throw new BadRequestException('Voice message is too large');

    const detectedContentType = this.detectAudioContentType(buffer);
    if (!detectedContentType) throw new BadRequestException('Invalid voice message type');

    const normalizedDeclaredType = declaredContentType.split(';')[0].trim().toLowerCase();
    const compatibleTypes: Record<string, string[]> = {
      'audio/webm': ['audio/webm'],
      'audio/ogg': ['audio/ogg'],
      'audio/mp4': ['audio/mp4', 'audio/x-m4a'],
      'audio/wav': ['audio/wav', 'audio/wave', 'audio/x-wav'],
      'audio/mpeg': ['audio/mpeg', 'audio/mp3'],
    };

    if (!compatibleTypes[detectedContentType]?.includes(normalizedDeclaredType)) {
      throw new BadRequestException('Voice message content does not match its file type');
    }

    return detectedContentType;
  }

  private detectAudioContentType(buffer: Buffer): string | null {
    if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
      return 'audio/webm';
    }
    if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
    if (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WAVE'
    ) {
      return 'audio/wav';
    }
    if (buffer.length >= 8 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
    if (
      buffer.length >= 3 &&
      (buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0))
    ) {
      return 'audio/mpeg';
    }
    return null;
  }

  private safeFileName(originalFileName: string, mimeType: string, fallbackName = 'image'): string {
    const extensionByMime: Record<string, string> = {
      'image/jpeg': 'jpg',
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
      'audio/mp4': 'm4a',
      'audio/wav': 'wav',
      'audio/mpeg': 'mp3',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/webm': 'webm',
    };
    const extension = extensionByMime[mimeType] ?? mimeType.split('/')[1];
    const baseName =
      originalFileName
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 80) || fallbackName;
    return `${baseName}.${extension}`;
  }

  private safeGenericFileName(originalFileName: string): string {
    const cleaned = originalFileName.replace(/[^a-zA-Z0-9._()-]/g, '_').slice(0, 120);
    return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'file';
  }

  private getBucket(): GridFSBucket {
    if (!this.bucket) throw new Error('Message media storage is not initialized');
    return this.bucket;
  }
}

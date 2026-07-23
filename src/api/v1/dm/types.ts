export type MultipartField = {
  type: 'field';
  value: unknown;
};

export type MultipartUpload = {
  type: 'file';
  fieldname: string;
  filename: string;
  mimetype: string;
  fields: Record<string, MultipartPart | MultipartPart[] | undefined>;
  toBuffer: () => Promise<Buffer>;
};

export type MultipartPart = MultipartField | MultipartUpload;

export type MultipartRequest = {
  file: (options?: { limits?: { fileSize?: number; files?: number } }) => Promise<MultipartUpload | undefined>;
};

export type UploadedImage = {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
};

export type UploadedVoice = UploadedImage & {
  durationMs: number;
};

export type UploadedVideo = UploadedImage & {
  durationMs?: number;
};

export type UploadedFile = UploadedImage;

export type SendMessageOptions = {
  attachments?: MessageMediaAttachment[];
  replyToId?: string;
};
import type { MessageMediaAttachment } from 'src/message-media/message-media.types';

export type ImageMessageAttachment = {
  type: 'IMAGE';
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
};

export type VoiceMessageAttachment = {
  type: 'VOICE';
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  durationMs: number;
};

export type VideoMessageAttachment = {
  type: 'VIDEO';
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  durationMs?: number;
};

export type FileMessageAttachment = {
  type: 'FILE';
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
};

export type MessageMediaAttachment =
  | ImageMessageAttachment
  | VoiceMessageAttachment
  | VideoMessageAttachment
  | FileMessageAttachment;

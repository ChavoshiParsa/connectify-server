export type AvatarUpload = {
  fieldname: string;
  mimetype: string;
  toBuffer: () => Promise<Buffer>;
};

export type AvatarMultipartRequest = {
  file: (options?: { limits?: { fileSize?: number; files?: number } }) => Promise<AvatarUpload | undefined>;
};

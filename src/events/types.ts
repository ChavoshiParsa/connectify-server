import { Socket } from 'socket.io';

export type AuthenticatedSocket = Socket & {
  userId?: string;
  publicId?: string;
};

export type MessageNewPayload = {
  messageId: string;
  dmKey: string;
  senderPublicId: string;
  recipientPublicId: string;
  createdAt: Date;
};

export type MessageNewEventData = Omit<MessageNewPayload, 'recipientPublicId'>;

export type MessageEditedPayload = {
  messageId: string;
  dmKey: string;
  editorPublicId: string;
  recipientPublicId: string;
  editedAt: Date;
};

export type MessageEditedEventData = Omit<MessageEditedPayload, 'recipientPublicId'>;

export type MessageDeletedPayload = {
  messageId: string;
  dmKey: string;
  deletedByPublicId: string;
  recipientPublicId: string;
  deletedAt: Date;
};

export type MessageDeletedEventData = Omit<MessageDeletedPayload, 'recipientPublicId'>;

export type MessagesSeenPayload = {
  messageIds: string[];
  dmKey: string;
  seenByPublicId: string;
  recipientPublicId: string;
  readAt: Date;
};

export type MessagesSeenEventData = Omit<MessagesSeenPayload, 'recipientPublicId'>;

export type MessageSeenAllPayload = {
  dmKey: string;
  seenAllByPublicId: string;
  recipientPublicId: string;
  readAt: Date;
};

export type MessageSeenAllEventData = Omit<MessageSeenAllPayload, 'recipientPublicId'>;

export type TypingStartPayload = {
  dmKey: string;
  userPublicId: string;
  recipientPublicId: string;
};

export type TypingStartEventData = Omit<TypingStartPayload, 'recipientPublicId'>;

export type UserStatusPayload = {
  publicId: string;
  status: 'ONLINE' | 'OFFLINE';
  lastActiveAt: Date;
};

export type UserProfileUpdatedPayload = {
  publicId: string;
  updatedFields: string[];
};

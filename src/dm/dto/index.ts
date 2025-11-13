import { IsString } from 'class-validator';

export class SendMessageDto {
  @IsString()
  recipientPublicId: string;

  @IsString()
  content: string;
}

export class SeenMessageDto {
  @IsString()
  messageId: string;
}

export class SeenAllMessagesDto {
  @IsString()
  dmKey: string;
}

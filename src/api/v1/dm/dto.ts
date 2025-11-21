import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class MessageDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content: string;
}

export class GetRoomMessagesDto {
  @IsOptional()
  @IsISO8601()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class DmKeyDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9_-]+~[a-zA-Z0-9_-]+$/, {
    message: 'DM key format must be "userA~userB"',
  })
  dmKey: string;

  static sortAndValidate(dmKey: string): string {
    const parts = dmKey.split('~');
    if (parts.length !== 2) {
      throw new BadRequestException('Invalid DM key format. Expected format: userA~userB');
    }

    const [userA, userB] = parts;
    return [userA, userB].sort().join('~');
  }
}

export class SeenMessagesDto {
  @IsArray()
  messageIds: string[];
}

import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CheckUsernameDto {
  @IsString()
  @Transform(({ value }: { value?: string }) => value?.trim().toLowerCase())
  @Matches(/^[a-z][a-z0-9_]+$/, {
    message: 'Username must start with a letter and contain only letters, numbers, and underscores.',
  })
  @Length(3, 12)
  username!: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value?: string }) => value?.trim())
  @Length(1, 24)
  firstName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value?: string }) => value?.trim())
  @Length(1, 24)
  lastName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z].*$/, { message: 'Username must start with a letter.' })
  @Matches(/^[A-Za-z0-9_]+$/, {
    message: 'Only letters, numbers, and underscores are allowed.',
  })
  @Length(3, 12, { message: 'Username must be 3–12 characters long.' })
  username?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value?: string }) => value?.trim())
  @Length(1, 128)
  biography?: string;
}

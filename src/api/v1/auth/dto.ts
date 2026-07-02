import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export const EmailField = () =>
  applyDecorators(
    IsEmail(),
    Transform(({ value }: { value?: string }) => value?.trim().toLowerCase()),
  );

export const PasswordField = () =>
  applyDecorators(
    IsString(),
    MinLength(8),
    IsNotEmpty(),
    Transform(({ value }: { value?: string }) => value?.trim()),
  );

export class ValidateDto {
  @EmailField()
  email!: string;

  @PasswordField()
  password!: string;
}

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value?: string }) => value?.trim())
  @Length(1, 24)
  firstName!: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }: { value?: string }) => value?.trim())
  @Length(1, 24)
  lastName?: string;

  @EmailField()
  email!: string;

  // @IsString()
  // @Matches(/^[A-Za-z].*$/, { message: 'Username must start with a letter.' })
  // @Matches(/^[A-Za-z0-9_]+$/, { message: 'Only letters, numbers, and underscores are allowed.' })
  // @Length(3, 12, { message: 'Username must be 3–12 characters long.' })
  // username: string;

  @PasswordField()
  //  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
  //   message: 'Password must contain uppercase, lowercase, and a number',
  // })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  @Matches(/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/)
  avatarBase64?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;
}

export class LoginDto {
  @EmailField()
  email!: string;

  @PasswordField()
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;
}

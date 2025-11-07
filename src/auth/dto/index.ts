import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class ValidateDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

export class RegisterDto {
  @IsString()
  firstName: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsEmail()
  email: string;

  // @IsString()
  // @Matches(/^[A-Za-z].*$/, {
  //   message: 'Username must start with a letter.',
  // })
  // @Matches(/^[A-Za-z0-9_]+$/, {
  //   message: 'Only letters, numbers, and underscores are allowed.',
  // })
  // @Length(3, 12, {
  //   message: 'Username must be 3–12 characters long.',
  // })
  // username: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  @Matches(/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/)
  avatarBase64?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}

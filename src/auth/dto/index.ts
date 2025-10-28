import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  firstName: string;

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
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}

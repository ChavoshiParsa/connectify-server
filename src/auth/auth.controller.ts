import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, ValidateDto } from './dto';
import { JwtGuard } from './guards/jwt.guard';
import { RefreshGuard } from './guards/refresh.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('validate')
  @HttpCode(200)
  async validate(@Body() dto: ValidateDto) {
    return this.authService.validateEmailPass(dto);
  }

  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const userAgent = req.headers['user-agent'] || 'unknown';
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      req.ip ||
      'unknown';

    const { accessToken, refreshToken, deviceId, user } = await this.authService.register(dto, userAgent, ip);
    const { id: _id, passwordHash: _passwordHash, ...safeUser } = user;

    this.setRefreshCookie(res, refreshToken);
    return { accessToken, deviceId, user: safeUser };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const userAgent = req.headers['user-agent'] || 'unknown';
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      req.ip ||
      'unknown';

    const { accessToken, refreshToken, deviceId, isNewDevice, user } = await this.authService.login(dto, userAgent, ip);
    const { id: _id, passwordHash: _passwordHash, ...safeUser } = user;

    this.setRefreshCookie(res, refreshToken);
    return { accessToken, deviceId, user: safeUser, isNewDevice };
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(RefreshGuard)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const userId = req.user?.userId;
    const refreshToken = req.user?.refreshToken;
    const deviceId = req.user?.deviceId;

    if (!userId || !refreshToken || !deviceId) throw new UnauthorizedException('Invalid refresh payload');

    const { accessToken, refreshToken: newRefreshToken } = await this.authService.refreshTokens(
      userId,
      refreshToken,
      deviceId,
    );
    this.setRefreshCookie(res, newRefreshToken);
    return { accessToken, deviceId };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const userId = req.user?.userId;
    const deviceId = req.user?.deviceId;

    if (!userId || !deviceId) throw new ForbiddenException('Access denied');
    await this.authService.logout(userId, deviceId);
    res.clearCookie('refreshToken', { ...this.refreshCookieOptions });
    return { message: 'Logged out' };
  }

  private setRefreshCookie(res: Response, refreshToken: string) {
    res.cookie('refreshToken', refreshToken, {
      ...this.refreshCookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  private readonly refreshCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/auth/refresh',
  };
}

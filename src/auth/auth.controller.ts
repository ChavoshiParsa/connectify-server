import { Body, Controller, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto';
import { JwtGuard } from './guards/jwt.guard';
import { RefreshGuard } from './guards/refresh.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

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
  @UseGuards(RefreshGuard)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const userId = req.user?.userId;
    const refreshToken = req.user?.refreshToken;
    const deviceId = req.user?.deviceId;

    if (!userId || !refreshToken || !deviceId) {
      throw new UnauthorizedException('Invalid refresh payload');
    }

    const { accessToken, refreshToken: newRefreshToken } = await this.authService.refreshTokens(
      userId,
      refreshToken,
      deviceId,
    );
    this.setRefreshCookie(res, newRefreshToken);
    return { accessToken };
  }

  @Post('logout')
  @UseGuards(JwtGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const userId = req.user?.userId;
    const deviceId = req.user?.deviceId;

    if (!userId || !deviceId) {
      throw new UnauthorizedException('Invalid logout payload');
    }

    await this.authService.logout(userId, deviceId);
    res.clearCookie('refreshToken');
    return { message: 'Logged out' };
  }

  private setRefreshCookie(res: Response, refreshToken: string) {
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/auth/refresh',
    });
  }
}

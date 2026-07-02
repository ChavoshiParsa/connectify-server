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
import { getClientIp, getUserAgent, type AppFastifyReply, type AppFastifyRequest } from 'src/common/types/http';
import { IS_PROD } from 'src/env';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, ValidateDto } from './dto';
import { RefreshGuard } from './guards/refresh.guard';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('validate')
  @HttpCode(200)
  async validate(@Body() dto: ValidateDto) {
    return this.authService.validateEmailPass(dto);
  }

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: AppFastifyRequest,
    @Res({ passthrough: true }) res: AppFastifyReply,
  ) {
    const userAgent = getUserAgent(req);
    const ip = getClientIp(req);

    const { accessToken, refreshToken, deviceId, user } = await this.authService.register(dto, userAgent, ip);
    const { id: _id, passwordHash: _passwordHash, ...safeUser } = user;

    this.setRefreshCookie(res, refreshToken);
    return { accessToken, deviceId, user: safeUser };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: AppFastifyRequest, @Res({ passthrough: true }) res: AppFastifyReply) {
    const userAgent = getUserAgent(req);
    const ip = getClientIp(req);

    const { accessToken, refreshToken, deviceId, isNewDevice, user } = await this.authService.login(dto, userAgent, ip);
    const { id: _id, passwordHash: _passwordHash, ...safeUser } = user;

    this.setRefreshCookie(res, refreshToken);
    return { accessToken, deviceId, user: safeUser, isNewDevice };
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(RefreshGuard)
  async refresh(@Req() req: AppFastifyRequest, @Res({ passthrough: true }) res: AppFastifyReply) {
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
  @UseGuards(RefreshGuard)
  async logout(@Req() req: AppFastifyRequest, @Res({ passthrough: true }) res: AppFastifyReply) {
    const userId = req.user?.userId;
    const deviceId = req.user?.deviceId;

    if (!userId || !deviceId) throw new ForbiddenException('Access denied');
    await this.authService.logout(userId, deviceId);
    res.clearCookie('refreshToken', { path: this.refreshCookieOptions.path });
    return { message: 'Logged out' };
  }

  private setRefreshCookie(reply: AppFastifyReply, refreshToken: string) {
    reply.setCookie('refreshToken', refreshToken, {
      ...this.refreshCookieOptions,
      maxAge: 7 * 24 * 60 * 60,
    });
  }

  private readonly refreshCookieOptions = {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? ('none' as const) : ('lax' as const),
    path: '/',
  };
}

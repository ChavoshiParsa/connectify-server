import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { AppFastifyRequest } from 'src/common/types/http';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload } from '../types';

@Injectable()
export class RefreshStrategy extends PassportStrategy(Strategy, 'refresh') {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: AppFastifyRequest): string | null => {
          const token = req.cookies?.refreshToken;

          return typeof token === 'string' && token.length > 0 ? token : null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_REFRESH_SECRET')!,
      passReqToCallback: true,
    });
  }

  validate(req: AppFastifyRequest, payload: JwtPayload) {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) throw new UnauthorizedException('No refresh token');
    return { userId: payload.sub, email: payload.email, deviceId: payload.deviceId, refreshToken };
  }
}

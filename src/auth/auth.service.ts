import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AvatarColor } from 'generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LoginDto, RegisterDto } from './dto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  async register(dto: RegisterDto, userAgent: string, ip: string) {
    const existingEmail = await this.usersService.findByEmail(dto.email.trim().toLowerCase());
    if (existingEmail) {
      throw new BadRequestException('Email already in use');
    }

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.usersService.createUser({
      firstName: dto.firstName,
      email: dto.email.trim().toLowerCase(),
      passwordHash,
      avatarColor: this.getRandomAvatarColor(),
    });

    const deviceId = dto?.deviceId || crypto.randomUUID();
    const tokens = await this.generateTokens(user.id, user.email, deviceId);
    await this.createSession(user.id, tokens.refreshToken, deviceId, userAgent, ip);
    return { ...tokens, deviceId, user };
  }

  async login(dto: LoginDto, userAgent: string, ip: string) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const existingSession = dto?.deviceId
      ? await this.prisma.session.findFirst({
          where: {
            userId: user.id,
            deviceId: dto?.deviceId,
          },
        })
      : null;

    const deviceId = dto.deviceId ?? crypto.randomUUID();

    const tokens = await this.generateTokens(user.id, user.email, deviceId);

    const expired = existingSession && existingSession.expiresAt < new Date();
    const session =
      !existingSession || expired
        ? await this.createSession(user.id, tokens.refreshToken, deviceId, userAgent, ip)
        : await this.updateSession(existingSession.id, tokens.refreshToken, deviceId, userAgent, ip);

    await this.usersService.updateLastLogin(user.id);

    return {
      ...tokens,
      user,
      deviceId,
      sessionId: session.id,
      isNewDevice: !existingSession,
    };
  }

  async refreshTokens(userId: string, refreshToken: string, deviceId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException();

    const session = await this.prisma.session.findFirst({ where: { userId, deviceId } });
    if (!session) throw new UnauthorizedException('Invalid session');

    const valid = await argon2.verify(session.hashedRt, refreshToken);
    if (!valid) {
      await this.prisma.session.deleteMany({ where: { userId, deviceId } });
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const tokens = await this.generateTokens(userId, user.email, deviceId);
    await this.updateSession(session.id, tokens.refreshToken, deviceId, session.userAgent, session.ip);
    return tokens;
  }

  async logout(userId: string, deviceId: string) {
    const matchingSession = await this.prisma.session.findFirst({
      where: { userId, deviceId },
    });

    if (matchingSession) {
      await this.prisma.session.delete({
        where: { id: matchingSession.id },
      });
    }
  }

  private async generateTokens(userId: string, email: string, deviceId: string) {
    const accessOptions: JwtSignOptions = {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.configService.get<string>('JWT_ACCESS_TTL') as JwtSignOptions['expiresIn'],
    };
    const refreshOptions: JwtSignOptions = {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_TTL') as JwtSignOptions['expiresIn'],
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync({ sub: userId, email, deviceId }, accessOptions),
      this.jwtService.signAsync({ sub: userId, email, deviceId }, refreshOptions),
    ]);
    return { accessToken, refreshToken };
  }

  private async createSession(userId: string, refreshToken: string, deviceId: string, userAgent: string, ip: string) {
    const hashedRt = await argon2.hash(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    return await this.prisma.session.create({
      data: {
        userId,
        hashedRt,
        deviceId,
        userAgent,
        ip,
        expiresAt,
      },
    });
  }

  private async updateSession(
    sessionId: string,
    refreshToken: string,
    deviceId: string,
    userAgent: string,
    ip: string,
  ) {
    const hashedRt = await argon2.hash(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    return await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        hashedRt,
        deviceId,
        userAgent,
        ip,
        expiresAt,
      },
    });
  }

  private getRandomAvatarColor(): AvatarColor {
    const colors = Object.values(AvatarColor);
    const randomIndex = Math.floor(Math.random() * colors.length);
    return colors[randomIndex];
  }
}

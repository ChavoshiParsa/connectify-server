import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto';
import { Session } from 'generated/prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.usersService.findByEmail(dto.email);
    if (existingUser) {
      throw new BadRequestException('Email already in use');
    }

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.usersService.createUser({
      email: dto.email,
      username: dto.username,
      passwordHash,
    });

    return this.generateTokens(user.id, user.email);
  }

  async login(dto: LoginDto, userAgent: string, ip: string) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.usersService.updateLastLogin(user.id);

    const tokens = await this.generateTokens(user.id, user.email);
    await this.createSession(user.id, tokens.refreshToken, userAgent, ip);

    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user };
  }

  async refreshTokens(userId: string, refreshToken: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException();

    const sessions = await this.prisma.session.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
    });

    let matchingSession: Session | undefined;
    for (const session of sessions) {
      if (session.hashedRt && (await argon2.verify(session.hashedRt, refreshToken))) {
        matchingSession = session;
        break;
      }
    }

    if (!matchingSession) throw new UnauthorizedException('Invalid refresh token');

    // Rotate refresh token
    const newTokens = await this.generateTokens(userId, user.email);
    await this.prisma.session.update({
      where: { id: matchingSession.id },
      data: { hashedRt: await argon2.hash(newTokens.refreshToken) },
    });

    return newTokens;
  }

  async logout(userId: string, refreshToken: string) {
    const sessions = await this.prisma.session.findMany({ where: { userId } });

    let matchingSession: Session | undefined;
    for (const session of sessions) {
      if (session.hashedRt && (await argon2.verify(session.hashedRt, refreshToken))) {
        matchingSession = session;
        break;
      }
    }

    if (matchingSession) {
      await this.prisma.session.update({
        where: { id: matchingSession.id },
        data: { hashedRt: null }, // Or delete the session
      });
    }
  }

  private async generateTokens(userId: string, email: string) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync({ sub: userId, email }),
      this.jwtService.signAsync(
        { sub: userId, email },
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          expiresIn: this.configService.get<string>('JWT_REFRESH_TTL') as JwtSignOptions['expiresIn'],
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  private async createSession(userId: string, refreshToken: string, userAgent: string, ip: string) {
    const hashedRt = await argon2.hash(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.prisma.session.create({
      data: {
        userId,
        hashedRt,
        userAgent,
        ip,
        expiresAt,
      },
    });
  }
}

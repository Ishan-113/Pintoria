import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { buildSessionUser, SessionUser } from './auth.types';
import { LoginDto, SetPasswordDto } from './dto/auth.dto';
import { RateLimiterService } from './rate-limiter.service';
import { TokensService } from './tokens.service';

export type { SessionUser };

const INVITE_TTL_HOURS = 48;
const RESET_TTL_HOURS = 1;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly rate: RateLimiterService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private linkPrefix(): string {
    const origins = this.config.get<string[]>('webOrigins') ?? [];
    return (origins[0] ?? 'http://localhost:5173').replace(/\/$/, '');
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  async login(dto: LoginDto, ip: string, userAgent: string) {
    const key = RateLimiterService.loginKey(ip, dto.email);
    this.rate.assertAllowed(key);

    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.trim().toLowerCase(), deletedAt: null },
    });
    const ok = user ? await bcrypt.compare(dto.password, user.passwordHash) : false;
    if (!user || !ok) {
      this.rate.registerFailure(key);
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('This account is not active. Contact Printoria or your head office.');
    }

    this.rate.reset(key);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const pair = await this.tokens.issuePair(user, ip, userAgent);
    return { accessToken: pair.accessToken, refreshToken: pair.refreshToken, user: buildSessionUser(user) };
  }

  me(user: SessionUser): SessionUser {
    return user;
  }

  logout(rawRefresh: string): Promise<void> {
    return this.tokens.revoke(rawRefresh);
  }

  private async createAuthToken(
    userId: string,
    purpose: 'INVITE' | 'RESET_PASSWORD',
    ttlHours: number,
  ): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    await this.prisma.authToken.create({
      data: {
        userId,
        purpose,
        tokenHash: this.hash(raw),
        expiresAt: new Date(Date.now() + ttlHours * 3600000),
      },
    });
    return raw;
  }

  async forgotPassword(email: string, ip: string): Promise<void> {
    // cap: hard limit regardless of outcome, so links cannot be mass-issued
    this.rate.assertCap('forgot', ip, 3);
    const user = await this.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), deletedAt: null },
    });
    if (!user || user.status !== 'ACTIVE') return; // no account enumeration
    const raw = await this.createAuthToken(user.id, 'RESET_PASSWORD', RESET_TTL_HOURS);
    const link = `${this.linkPrefix()}/reset-password?token=${raw}`;
    await this.mail.sendPasswordReset(user.email, user.fullName, link);
  }

  async resetPassword(token: string, password: string, ip: string): Promise<void> {
    this.rate.assertCap('reset', ip);
    const rec = await this.prisma.authToken.findUnique({
      where: { tokenHash: this.hash(token) },
    });
    if (
      !rec ||
      rec.purpose !== 'RESET_PASSWORD' ||
      rec.usedAt !== null ||
      rec.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException(
        'This password reset link is invalid or has expired. Please request a new one.',
      );
    }
    await this.finishPasswordChange(rec.userId, password, 'auth.password_reset');
    await this.prisma.authToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } });
  }

  async getInviteInfo(token: string) {
    const rec = await this.prisma.authToken.findUnique({
      where: { tokenHash: this.hash(token) },
      include: { user: { include: { client: { select: { name: true } } } } },
    });
    if (!rec || rec.purpose !== 'INVITE' || rec.usedAt !== null || rec.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException('This invitation is invalid or has expired.');
    }
    return {
      email: rec.user.email,
      fullName: rec.user.fullName,
      clientName: rec.user.client?.name ?? null,
      expiresAt: rec.expiresAt,
    };
  }

  async acceptInvite(dto: SetPasswordDto, ip: string): Promise<void> {
    this.rate.assertCap('accept', ip);
    const rec = await this.prisma.authToken.findUnique({
      where: { tokenHash: this.hash(dto.token) },
      include: { user: true },
    });
    if (!rec || rec.purpose !== 'INVITE' || rec.usedAt !== null || rec.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'This invitation is invalid or has expired. Ask your Printoria admin to resend it.',
      );
    }
    await this.finishPasswordChange(rec.userId, dto.password, 'auth.invite_accepted');
    await this.prisma.authToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } });
  }

  private async finishPasswordChange(userId: string, password: string, action: string): Promise<void> {
    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash, status: 'ACTIVE' },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({ actorId: userId, entityType: 'User', entityId: userId, action });
  }

  /** Used by the admin module (checkpoint 1c) to invite admin-created users. */
  async createInvitation(userId: string, actorId: string): Promise<{ sent: true; devLink?: string }> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new NotFoundException('User not found.');
    const raw = await this.createAuthToken(user.id, 'INVITE', INVITE_TTL_HOURS);
    const link = `${this.linkPrefix()}/accept-invite?token=${raw}`;
    const client = user.clientId
      ? await this.prisma.client.findUnique({ where: { id: user.clientId }, select: { name: true } })
      : null;
    await this.mail.sendInvitation(user.email, user.fullName, client?.name ?? 'Printoria International', link);
    await this.audit.record({
      actorId,
      entityType: 'User',
      entityId: user.id,
      action: 'auth.invite_issued',
    });
    return { sent: true, ...(process.env.NODE_ENV === 'local' ? { devLink: link } : {}) };
  }
}

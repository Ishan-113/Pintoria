import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** @nestjs/jwt expects ms-like strings; supports '15m', '7d', '900s', '45h'. */
function parseTtl(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!m) throw new Error(`Invalid TTL value: ${ttl}`);
  const n = Number(m[1]);
  switch (m[2]) {
    case 's':
      return n * 1000;
    case 'm':
      return n * 60000;
    case 'h':
      return n * 3600000;
    case 'd':
      return n * 86400000;
    default:
      throw new Error(`Invalid TTL value: ${ttl}`);
  }
}

@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issuePair(
    user: { id: string },
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<TokenPair> {
    const refresh = randomBytes(48).toString('base64url');
    const ttl = this.config.getOrThrow<string>('JWT_REFRESH_TTL');
    const expiresAt = new Date(Date.now() + parseTtl(ttl));
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hash(refresh),
        expiresAt,
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      },
    });
    const accessToken = await this.jwt.signAsync({ sub: user.id });
    return { accessToken, refreshToken: refresh };
  }

  /** Single-use refresh with rotation; reuse of a rotated token revokes the whole family. */
  async rotate(rawRefresh: string, ip?: string | null, userAgent?: string | null): Promise<TokenPair> {
    const rec = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(rawRefresh) },
      include: { user: true },
    });
    if (!rec || rec.revokedAt || rec.expiresAt.getTime() <= Date.now()) {
      if (rec && rec.revokedAt) await this.revokeAllForUser(rec.userId); // detected reuse
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }
    if (rec.user.deletedAt || rec.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }
    await this.prisma.refreshToken.update({
      where: { id: rec.id },
      data: { revokedAt: new Date() },
    });
    return this.issuePair(rec.user, ip ?? rec.ip, userAgent ?? rec.userAgent);
  }

  async revoke(rawRefresh: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(rawRefresh), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

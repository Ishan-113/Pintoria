import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface WindowRecord {
  count: number;
  windowStart: number;
  blockedUntil?: number;
}

/**
 * In-memory rate limiter (per API instance).
 * LOGIN keys: failure-counting with window reset on success.
 * CAP keys: hard cap per window regardless of success (password reset / invite requests).
 * Swap for a pg-backed store if the API ever scales horizontally.
 */
@Injectable()
export class RateLimiterService {
  private readonly windows = new Map<string, WindowRecord>();
  private readonly caps = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly capLimit = 5;

  constructor(config: ConfigService) {
    this.limit = config.get<number>('LOGIN_ATTEMPTS_LIMIT') ?? 5;
    this.windowMs = (config.get<number>('LOGIN_WINDOW_MINUTES') ?? 15) * 60000;
  }

  static loginKey(ip: string, email: string): string {
    return `login:${ip}:${email.trim().toLowerCase()}`;
  }

  private static capKey(scope: string, ip: string): string {
    return `cap:${scope}:${ip}`;
  }

  private pruneWindows() {
    const now = Date.now();
    for (const [k, rec] of this.windows) {
      const expired = rec.blockedUntil
        ? now >= rec.blockedUntil
        : now - rec.windowStart > this.windowMs;
      if (expired) this.windows.delete(k);
    }
  }

  /** Throws 429 when the key is blocked. */
  assertAllowed(key: string): void {
    this.pruneWindows();
    const rec = this.windows.get(key);
    if (rec?.blockedUntil && rec.blockedUntil > Date.now()) {
      const mins = Math.ceil((rec.blockedUntil - Date.now()) / 60000);
      throw new HttpException(
        `Too many failed attempts. Try again in ${mins} minute(s).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  registerFailure(key: string): void {
    const now = Date.now();
    let rec = this.windows.get(key);
    if (!rec || now - rec.windowStart > this.windowMs) {
      rec = { count: 0, windowStart: now };
    }
    rec.count += 1;
    if (rec.count >= this.limit) {
      rec.blockedUntil = now + this.windowMs;
    }
    this.windows.set(key, rec);
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  /** Hard-attempts guard with rolling window; counts every request. */
  assertCap(scope: string, ip: string, limit = this.capLimit): void {
    const key = RateLimiterService.capKey(scope, ip);
    const now = Date.now();
    const stamps = (this.caps.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (stamps.length >= limit) {
      const mins = Math.ceil((this.windowMs - (now - stamps[0])) / 60000);
      throw new HttpException(
        `Too many requests. Try again in ${mins} minute(s).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    stamps.push(now);
    this.caps.set(key, stamps);
  }
}

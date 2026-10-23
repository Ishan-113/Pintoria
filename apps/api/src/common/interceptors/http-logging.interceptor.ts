import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { tap } from 'rxjs';
import { COMMERCIAL_KEYS, PRICING_KEYS } from '@pintoria/shared';
import type { SessionUser } from '../../auth/auth.types';

const SECRET_BODY_KEYS = new Set([
  'password',
  'newpassword',
  'oldpassword',
  'confirmpassword',
  'token',
  'refreshtoken',
  'accesstoken',
  'authorization',
]);

const REDACTED = '[redacted]';

interface HttpRequestLike {
  method: string;
  url?: string;
  body?: unknown;
  user?: SessionUser;
}

interface HttpResponseLike {
  statusCode: number;
}

function sanitizeBody(body: unknown, depth = 0): unknown {
  if (body === null || body === undefined || typeof body !== 'object' || depth > 4) return REDACTED;
  if (Array.isArray(body)) {
    if (body.length > 20) return `[array:${body.length}]`;
    return body.map((v) => sanitizeBody(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    const lk = k.toLowerCase();
    if (SECRET_BODY_KEYS.has(lk) || PRICING_KEYS.has(k) || PRICING_KEYS.has(lk) || COMMERCIAL_KEYS.has(k) || COMMERCIAL_KEYS.has(lk)) {
      out[k] = REDACTED;
    } else {
      out[k] = sanitizeBody(v, depth + 1);
    }
  }
  return out;
}

/** Request logging that never logs passwords, tokens, or pricing/commercial fields. */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('http');

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<HttpRequestLike>();
    const method = request.method;
    const url = request.url?.split('?')[0] ?? '';
    const started = Date.now();
    const userId = request.user?.id ?? 'anonymous';

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<HttpResponseLike>();
          this.logger.log(
            `${method} ${url} ${res.statusCode} ${Date.now() - started}ms user=${userId}`,
          );
          if (request.body && method !== 'GET') {
            this.logger.debug(`payload=${JSON.stringify(sanitizeBody(request.body))}`);
          }
        },
        error: (err: { status?: number; message?: string }) => {
          this.logger.warn(
            `${method} ${url} ${err?.status ?? 500} ${Date.now() - started}ms user=${userId} err=${err?.message ?? 'unknown'}`,
          );
        },
      }),
    );
  }
}

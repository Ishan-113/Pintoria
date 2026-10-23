import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { tap } from 'rxjs';
import { hasPermission } from '@pintoria/shared';
import type { SessionUser } from '../../auth/auth.types';
import { PRICING_FIELDS_KEY } from '../decorators/pricing-field.decorator';
import { stripRestricted } from '../pricing/redact';

/**
 * Server-side pricing redaction.
 * For any authenticated user WITHOUT `pricing.view`, removes every pricing/commercial
 * key (shipped ones + handler-declared extra) from JSON responses before they leave the
 * process. Regional users can never hold `pricing.view`, so they are always redacted.
 */
@Injectable()
export class PricingRedactionInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<{ user?: SessionUser }>();
    const extra =
      this.reflector.getAllAndOverride<string[] | undefined>(PRICING_FIELDS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    return next.handle().pipe(
      tap((body) => {
        const user = request.user;
        if (!user) return;
        if (hasPermission(user.permissions, 'pricing.view')) return;
        if (body !== null && typeof body === 'object') {
          const widened = body as Record<string, unknown>;
          const stripped = stripRestricted(widened);
          // copy stripped top-level keys back onto the response object
          for (const [k, v] of Object.entries(stripped as Record<string, unknown>)) {
            widened[k] = v;
          }
          if (extra.length > 0) {
            deleteExtra(widened, extra);
          }
        }
      }),
    );
  }
}

function deleteExtra(obj: Record<string, unknown>, extra: string[]) {
  for (const key of extra) delete obj[key];
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') deleteExtra(v as Record<string, unknown>, extra);
  }
}

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { SessionUser } from '../../auth/auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as SessionUser | undefined;
  },
);

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@pintoria/shared';
import { hasPermission } from '@pintoria/shared';
import type { SessionUser } from '../../auth/auth.types';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: SessionUser }>();
    const user = request.user;
    if (!user) return false;
    if (!hasPermission(user.permissions, required)) {
      throw new ForbiddenException('You do not have permission to do this.');
    }
    return true;
  }
}

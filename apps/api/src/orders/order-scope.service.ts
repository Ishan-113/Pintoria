import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, User as PrismaUser } from '@prisma/client';
import type { SessionUser } from '../auth/auth.types';

/**
 * Central tenancy scoping: every order query/view must pass through here.
 * Regional users see only their own region; head office only their client;
 * Printoria staff see everything. Cross-tenant reads surface as 404.
 */
@Injectable()
export class OrderScopeService {
  whereFor(user: Pick<SessionUser, 'role' | 'clientId' | 'regionId'>): Prisma.OrderWhereInput {
    if (user.role === 'CLIENT_REGIONAL') {
      return { clientId: user.clientId ?? '__none__', regionId: user.regionId ?? '__none__' };
    }
    if (user.role.startsWith('CLIENT_')) {
      return { clientId: user.clientId ?? '__none__' };
    }
    return {};
  }

  /** Defense-in-depth check for records fetched without the scoped where. */
  assertCanView(
    order: Pick<PrismaUser, never> & { clientId: string; regionId: string },
    user: Pick<SessionUser, 'role' | 'clientId' | 'regionId'>,
  ): void {
    if (!user.role.startsWith('CLIENT_')) return;
    if (order.clientId !== user.clientId) {
      throw new NotFoundException('Order not found.');
    }
    if (user.role === 'CLIENT_REGIONAL' && order.regionId !== user.regionId) {
      throw new NotFoundException('Order not found.');
    }
  }
}

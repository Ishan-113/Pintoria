import type { Prisma } from '@prisma/client';
import type { OrderStatus } from '@pintoria/shared';
import type { ListOrdersDto } from './dto/orders.dto';
import type { OrderScopeService } from './order-scope.service';
import type { SessionUser } from '../auth/auth.types';

/** Shared list/export filter logic so GET /orders and the CSV report can never
 *  drift apart (tenancy scope, statuses, client/region, date range, search). */
export function buildOrderWhere(
  scope: OrderScopeService,
  user: SessionUser,
  q: Pick<ListOrdersDto, 'status' | 'clientId' | 'regionId' | 'dateFrom' | 'dateTo' | 'search'>,
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {
    ...scope.whereFor(user),
    deletedAt: null,
  };
  if (q.status) {
    const statuses = q.status
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is OrderStatus => s.length > 0);
    if (statuses.length > 0) where.status = { in: statuses };
  }
  if (q.clientId) where.clientId = q.clientId;
  if (q.regionId) where.regionId = q.regionId;
  if (q.dateFrom || q.dateTo) {
    where.createdAt = {
      gte: q.dateFrom ? new Date(q.dateFrom) : undefined,
      lte: q.dateTo ? new Date(q.dateTo) : undefined,
    };
  }
  if (q.search) {
    where.OR = ['title', 'orderNumber', 'itemName'].map((field) => ({
      [field]: { contains: q.search, mode: 'insensitive' as const },
    }));
  }
  return where;
}

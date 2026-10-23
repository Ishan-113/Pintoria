import { Injectable, NotFoundException } from '@nestjs/common';
import { ORDER_STATUSES } from '@pintoria/shared';
import type { OrderStatus, UserRole } from '@pintoria/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const TERMINAL_STATUSES: OrderStatus[] = ['REJECTED', 'CANCELLED', 'DELIVERED_CLOSED'];

export interface StageDelay {
  overlyByHours: number;
  thresholdHours: number;
}

export function isStageOverdue(
  statusEnteredAt: Date,
  now: Date,
  thresholdHours: number,
): StageDelay | null {
  if (thresholdHours <= 0) return null;
  const hoursInStage = (now.getTime() - statusEnteredAt.getTime()) / 3600000;
  if (hoursInStage <= thresholdHours) return null;
  return {
    overlyByHours: Math.round(hoursInStage - thresholdHours),
    thresholdHours,
  };
}

/** Returns the rows of `delay_threshold_hours` relevant for a stage. */
export function thresholdFor(
  status: OrderStatus,
  thresholds: { default: number; perStage: Record<string, number> },
): number {
  const specific = thresholds.perStage?.[status];
  if (typeof specific === 'number' && specific > 0) return specific;
  return thresholds.default ?? 0;
}

/** Role-scoped status filters for the queue cards. */
export function statusesForRole(role: UserRole): OrderStatus[] | null {
  switch (role) {
    case 'CLIENT_REGIONAL':
    case 'CLIENT_HEAD_OFFICE':
    case 'PRINTORIA_ADMIN':
      return null; // everything (still row-scoped by tenancy)
    case 'PRINTORIA_SALES':
      return ['QUOTATION_IN_PROGRESS', 'QUOTATION_SUBMITTED', 'REVISION_REQUESTED'];
    case 'PRINTORIA_OPS':
      return ['PO_RECEIVED', 'ORDER_CONFIRMED', 'IN_PRODUCTION', 'QUALITY_CHECK'];
    default:
      return [];
  }
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async overview(user: {
    id: string;
    role: UserRole;
    clientId: string | null;
    regionId: string | null;
  }) {
    const scope = this.scopeFor(user);
    const thresholds = await this.settings.get<{ default: number; perStage: Record<string, number> }>(
      'delay_threshold_hours',
    );
    const now = new Date();

    const [counts, recent, allOpen] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['status'],
        where: { ...scope, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.order.findMany({
        where: { ...scope, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          orderNumber: true,
          title: true,
          status: true,
          statusEnteredAt: true,
          createdAt: true,
        },
      }),
      this.prisma.order.findMany({
        where: {
          ...scope,
          deletedAt: null,
          status: { in: ORDER_STATUSES.filter((s) => !TERMINAL_STATUSES.includes(s)) },
        },
        select: { id: true, orderNumber: true, title: true, status: true, statusEnteredAt: true },
      }),
    ]);

    const countsByStatus: Record<string, number> = {};
    for (const c of counts) countsByStatus[c.status] = c._count._all;

    const delayedOrders = allOpen
      .map((o) => {
        const overdue = isStageOverdue(o.statusEnteredAt, now, thresholdFor(o.status, thresholds));
        return overdue ? { ...o, ...overdue } : null;
      })
      .filter((o): o is NonNullable<typeof o> => o !== null)
      .sort((a, b) => b.overlyByHours - a.overlyByHours)
      .slice(0, 10);

    const base = { countsByStatus, recentOrders: recent, delayedOrders };

    if (user.role === 'PRINTORIA_SALES') {
      const quotationsAwaitingDecision = await this.prisma.quotation.count({
        where: { status: 'SUBMITTED', deletedAt: null },
      });
      return { ...base, quotationsAwaitingDecision };
    }
    if (user.role === 'PRINTORIA_OPS') {
      const posPendingVerification = await this.prisma.purchaseOrder.count({
        where: { status: 'PENDING_VERIFICATION', deletedAt: null },
      });
      return { ...base, posPendingVerification };
    }
    if (user.role === 'PRINTORIA_ADMIN') {
      const [pendingInvites, clientCount] = await Promise.all([
        this.prisma.user.count({ where: { status: 'PENDING', deletedAt: null } }),
        this.prisma.client.count({ where: { deletedAt: null } }),
      ]);
      return { ...base, pendingInvites, clientCount };
    }
    return base;
  }

  private scopeFor(user: {
    id: string;
    role: UserRole;
    clientId: string | null;
    regionId: string | null;
  }): Prisma.OrderWhereInput {
    if (user.role === 'CLIENT_REGIONAL') {
      if (!user.clientId || !user.regionId) {
        throw new NotFoundException('Your account is missing client/region assignment.');
      }
      return { clientId: user.clientId, regionId: user.regionId };
    }
    if (user.role.startsWith('CLIENT_')) {
      if (!user.clientId) throw new NotFoundException('Your account is missing client assignment.');
      return { clientId: user.clientId };
    }
    return {};
  }
}

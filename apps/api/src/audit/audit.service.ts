import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

const slimAudit = (r: {
  id: bigint;
  [key: string]: unknown;
}) => ({ ...r, id: r.id.toString() });

/** Every state-changing write funnels through here (members call `record`). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    entry: AuditEntry,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const data: Prisma.AuditRecordCreateInput = {
      actor: entry.actorId ? { connect: { id: entry.actorId } } : undefined,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      before: entry.before === undefined ? undefined : (entry.before as object),
      after: entry.after === undefined ? undefined : (entry.after as object),
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    };
    if (tx) {
      await tx.auditRecord.create({ data });
    } else {
      await this.prisma.auditRecord.create({ data });
    }
  }

  async listFor(entityType: string, entityId: string, limit = 100) {
    const rows = await this.prisma.auditRecord.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: { select: { fullName: true, role: true, email: true } } },
    });
    return rows.map(slimAudit);
  }

  async listGlobal(filter: {
    entityType?: string;
    actorId?: string;
    from?: Date;
    to?: Date;
    page?: number;
    size?: number;
  }) {
    const page = filter.page ?? 1;
    const size = Math.min(filter.size ?? 25, 100);
    const where: Prisma.AuditRecordWhereInput = {
      entityType: filter.entityType || undefined,
      actorId: filter.actorId || undefined,
      createdAt: {
        gte: filter.from || undefined,
        lte: filter.to || undefined,
      },
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditRecord.count({ where }),
      this.prisma.auditRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
        include: { actor: { select: { fullName: true, role: true, email: true } } },
      }),
    ]);
    return { total, page, size, rows: rows.map(slimAudit) };
  }
}

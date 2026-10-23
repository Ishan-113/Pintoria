import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { hasPermission } from '@pintoria/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { SessionUser } from '../auth/auth.types';
import { buildOrderWhere } from './order-filters';
import { OrderNumberingService } from './order-numbering.service';
import { OrderScopeService } from './order-scope.service';
import { OrderTransitionsService, type TransitionOptions } from './order-transitions.service';
import {
  PoVerificationService,
  type PoCheckRow,
  type VerifyQuotation,
  type VerifyPo,
} from './po-verification.service';
import type {
  CreateOrderDto,
  ListOrdersDto,
  PoDecisionDto,
  PutQuotationDto,
  QuotationDecisionDto,
  RequirementDecisionDto,
  TransitionDto,
  UpdateRequirementDto,
  UploadPoDto,
} from './dto/orders.dto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dateOnly = (s: string): Date => new Date(`${s.slice(0, 10)}T00:00:00.000Z`);

const round2 = (n: number): number => Math.round(n * 100) / 100;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OrderScopeService,
    private readonly numbering: OrderNumberingService,
    private readonly transitions: OrderTransitionsService,
    private readonly poVerify: PoVerificationService,
  ) {}

  async create(user: SessionUser, dto: CreateOrderDto) {
    if (!user.clientId || !user.regionId) {
      throw new ForbiddenException('Your account is missing client/region assignment.');
    }
    return this.prisma.$transaction(async (tx) => {
      const orderNumber = await this.numbering.next(tx);
      const order = await tx.order.create({
        data: {
          orderNumber,
          clientId: user.clientId!,
          regionId: user.regionId!,
          createdById: user.id,
          title: dto.title,
          itemName: dto.itemName,
          quantity: dto.quantity,
          unit: dto.unit,
          requestedDeliveryDate: dateOnly(dto.requestedDeliveryDate),
          status: 'SUBMITTED',
          statusEnteredAt: new Date(),
        },
      });
      await tx.requirementVersion.create({
        data: {
          orderId: order.id,
          version: 1,
          itemName: dto.itemName,
          specification: dto.specification,
          quantity: dto.quantity,
          unit: dto.unit,
          requestedDeliveryDate: dateOnly(dto.requestedDeliveryDate),
          notes: dto.notes ?? null,
          submittedById: user.id,
        },
      });
      await this.transitions.execute(tx, order, user, 'submit_requirement', { comment: dto.notes });
      return order;
    });
  }

  async list(user: SessionUser, q: ListOrdersDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where: Prisma.OrderWhereInput = buildOrderWhere(this.scope, user, q);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { orderNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orderNumber: true,
          title: true,
          status: true,
          statusEnteredAt: true,
          quantity: true,
          unit: true,
          requestedDeliveryDate: true,
          createdAt: true,
          client: { select: { id: true, name: true, code: true } },
          region: { select: { id: true, name: true, code: true } },
        },
      }),
    ]);
    return { total, page, pageSize, rows };
  }

  async getById(user: SessionUser, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        client: { select: { id: true, name: true, code: true } },
        region: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, fullName: true, email: true } },
        requirementVersions: {
          where: { deletedAt: null },
          orderBy: { version: 'desc' },
        },
        quotations: {
          where: {
            deletedAt: null,
            ...(user.role.startsWith('CLIENT_') ? { NOT: { status: 'DRAFT' as const } } : {}),
          },
          orderBy: { version: 'desc' },
          include: { items: true },
        },
        purchaseOrders: {
          where: { deletedAt: null },
          orderBy: { uploadedAt: 'desc' },
          include: { checks: true },
        },
        statusLogs: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    this.scope.assertCanView(order, user);
    // regional accounts get no PO verification detail at all (values or rows)
    const purchaseOrders =
      user.role === 'CLIENT_REGIONAL'
        ? order.purchaseOrders.map(({ checks: _checks, poTotal, taxTotal, poItems: _poItems, ...rest }) => ({
            ...rest,
            poTotal: null as unknown as typeof poTotal,
            taxTotal: null as unknown as typeof taxTotal,
          }))
        : order.purchaseOrders;
    return {
      ...order,
      purchaseOrders,
      statusLogs: order.statusLogs.map((l) => ({ ...l, id: l.id.toString() })),
    };
  }

  async updateRequirement(user: SessionUser, orderId: string, dto: UpdateRequirementDto) {
    const order = await this.findScopedExisting(orderId);
    this.scope.assertCanView(order, user);
    return this.prisma.$transaction(async (tx) => {
      const to = await this.transitions.execute(tx, order, user, 'submit_requirement', {
        comment: dto.notes,
      });
      const last = await tx.requirementVersion.aggregate({
        _max: { version: true },
        where: { orderId },
      });
      const version = (last._max.version ?? 0) + 1;
      const rv = await tx.requirementVersion.create({
        data: {
          orderId,
          version,
          itemName: dto.itemName,
          specification: dto.specification,
          quantity: dto.quantity,
          unit: dto.unit,
          requestedDeliveryDate: dateOnly(dto.requestedDeliveryDate),
          notes: dto.notes ?? null,
          submittedById: user.id,
        },
      });
      if (to === 'SUBMITTED') {
        await tx.order.update({
          where: { id: orderId },
          data: {
            itemName: dto.itemName,
            quantity: dto.quantity,
            unit: dto.unit,
            requestedDeliveryDate: dateOnly(dto.requestedDeliveryDate),
          },
        });
      }
      return rv;
    });
  }

  async requirementDecision(user: SessionUser, orderId: string, dto: RequirementDecisionDto) {
    const order = await this.findScopedExisting(orderId);
    this.scope.assertCanView(order, user);
    const actionMap: Record<typeof dto.action, 'approve_requirement' | 'return_for_clarification' | 'reject_requirement'> = {
      approve: 'approve_requirement',
      return: 'return_for_clarification',
      reject: 'reject_requirement',
    };
    return this.prisma.$transaction(async (tx) => {
      const to = await this.transitions.execute(tx, order, user, actionMap[dto.action], {
        reason: dto.reason,
      });
      return { ok: true, status: to };
    });
  }

  async createQuotationDraft(user: SessionUser, orderId: string) {
    const order = await this.findScopedExisting(orderId);
    this.scope.assertCanView(order, user);
    if (order.status !== 'QUOTATION_IN_PROGRESS' && order.status !== 'REVISION_REQUESTED') {
      throw new BadRequestException(
        `Drafts can only be created while quoting (order is ${order.status}).`,
      );
    }
    const existing = await this.prisma.quotation.findFirst({
      where: { orderId, status: 'DRAFT', deletedAt: null },
      include: { items: true },
    });
    if (existing) return existing;
    const last = await this.prisma.quotation.aggregate({
      _max: { version: true },
      where: { orderId },
    });
    const version = (last._max.version ?? 0) + 1;
    return this.prisma.quotation.create({
      data: {
        orderId,
        version,
        quotationRef: `QTN-${order.orderNumber.slice(4)}-v${version}`,
        status: 'DRAFT',
      },
      include: { items: true },
    });
  }

  async updateQuotationDraft(user: SessionUser, quotationId: string, dto: PutQuotationDto) {
    const q = await this.getQuotationOrThrow(quotationId);
    this.scope.assertCanView({ clientId: q.order.clientId, regionId: q.order.regionId }, user);
    if (!hasPermission(user.permissions, 'quotation.manage')) {
      throw new ForbiddenException('Only Printoria sales can edit quotations.');
    }
    if (q.order.status !== 'QUOTATION_IN_PROGRESS' && q.order.status !== 'REVISION_REQUESTED') {
      throw new BadRequestException(
        `The order is not accepting quotation edits (${q.order.status}).`,
      );
    }
    if (q.status !== 'DRAFT') {
      throw new BadRequestException('Only draft quotations can be edited.');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.quotationItem.deleteMany({ where: { quotationId } });
      const totals = computeTotals(dto.items);
      await tx.quotation.update({
        where: { id: quotationId },
        data: {
          items: {
            create: dto.items.map((i) => ({
              description: i.description,
              specification: i.specification ?? null,
              quantity: i.quantity,
              unit: i.unit,
              unitRate: i.unitRate,
              taxRatePct: i.taxRatePct,
              amount: round2(i.quantity * i.unitRate),
            })),
          },
          paymentTerms: dto.paymentTerms ?? q.paymentTerms,
          deliveryTerms: dto.deliveryTerms ?? q.deliveryTerms,
          validityDate: dto.validityDate ? dateOnly(dto.validityDate) : q.validityDate,
          subTotal: totals.subTotal,
          taxAmount: totals.taxAmount,
          totalAmount: totals.total,
        },
      });
      const saved = await tx.quotation.findFirstOrThrow({
        where: { id: quotationId },
        include: { items: true },
      });
      return saved;
    });
  }

  async submitQuotation(user: SessionUser, quotationId: string) {
    const q = await this.getQuotationOrThrow(quotationId);
    this.scope.assertCanView({ clientId: q.order.clientId, regionId: q.order.regionId }, user);
    const items = await this.prisma.quotationItem.findMany({ where: { quotationId } });
    if (items.length === 0) {
      throw new UnprocessableEntityException('Add at least one item before submitting.');
    }
    return this.prisma.$transaction(async (tx) => {
      const to = await this.transitions.execute(tx, q.order, user, 'submit_quotation', {
        comment: `${q.quotationRef} submitted`,
      });
      const saved = await tx.quotation.update({
        where: { id: quotationId },
        data: {
          status: 'SUBMITTED',
          submittedById: user.id,
          submittedAt: new Date(),
        },
        include: { items: true },
      });
      return { to, quotation: saved };
    });
  }

  async quotationDecision(user: SessionUser, orderId: string, dto: QuotationDecisionDto) {
    const order = await this.findScopedExisting(orderId);
    this.scope.assertCanView(order, user);
    const quotation = await this.prisma.quotation.findFirst({
      where: { orderId, status: 'SUBMITTED', deletedAt: null },
      orderBy: { version: 'desc' },
    });
    if (!quotation) {
      throw new NotFoundException('No submitted quotation exists for this order.');
    }
    const actionMap = {
      approve: 'approve_quotation',
      request_revision: 'request_revision',
      reject: 'reject_quotation',
    } as const;
    const quotationStatus = {
      approve: 'APPROVED',
      request_revision: 'REVISION_REQUESTED',
      reject: 'REJECTED',
    } as const;
    return this.prisma.$transaction(async (tx) => {
      await tx.quotation.update({
        where: { id: quotation.id },
        data: {
          status: quotationStatus[dto.action],
          decision: {
            action: dto.action,
            reason: dto.reason ?? null,
            decidedById: user.id,
            at: new Date().toISOString(),
          },
        },
      });
      const to = await this.transitions.execute(tx, order, user, actionMap[dto.action], {
        reason: dto.reason,
      });
      return { ok: true, status: to };
    });
  }

  async uploadPo(user: SessionUser, orderId: string, dto: UploadPoDto) {
    const order = await this.findScopedExisting(orderId);
    this.scope.assertCanView(order, user);
    const approved = await this.prisma.quotation.findFirst({
      where: { orderId, status: 'APPROVED', deletedAt: null },
      orderBy: { version: 'desc' },
      include: { items: true },
    });
    if (!approved) {
      throw new UnprocessableEntityException('Upload requires an approved quotation.');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.updateMany({
        where: { orderId, status: { in: ['PENDING_VERIFICATION', 'QUERY_RAISED'] }, deletedAt: null },
        data: { status: 'SUPERSEDED' },
      });
      const checks = this.poVerify.compute(
        this.toVerifyQuotation(approved),
        this.toVerifyPo(dto),
        order.requestedDeliveryDate,
      );
      const po = await tx.purchaseOrder.create({
        data: {
          orderId,
          poNumber: dto.poNumber,
          poDate: dateOnly(dto.poDate),
          poItems: dto.poItems.map((i) => ({
            description: i.description,
            quantity: i.quantity,
            unit: i.unit ?? approved.items[0]?.unit ?? 'nos',
            unitRate: i.unitRate,
          })),
          poTotal: dto.poTotal,
          taxTotal: dto.taxTotal ?? null,
          paymentTerms: dto.paymentTerms ?? null,
          expectedDeliveryDate: dto.expectedDeliveryDate
            ? dateOnly(dto.expectedDeliveryDate)
            : null,
          externalRef: dto.externalRef ?? null,
          status: 'PENDING_VERIFICATION',
          uploadedById: user.id,
          checks: {
            create: checks.map((c) => ({
              checkKey: c.key,
              checkLabel: c.label,
              expected: c.expected,
              actual: c.actual,
              matched: c.matched,
              remark: c.remark,
            })),
          },
        },
        include: { checks: true },
      });
      await this.transitions.execute(tx, order, user, 'upload_po', {
        comment: `PO ${dto.poNumber} uploaded`,
        payload: { mismatches: checks.filter((c) => c.matched === false).length },
      });
      return po;
    });
  }

  async getPoChecklist(user: SessionUser, orderId: string, poId: string) {
    const order = await this.findScopedExisting(orderId);
    this.scope.assertCanView(order, user);
    if (user.role === 'CLIENT_REGIONAL') {
      throw new ForbiddenException('PO verification details are not available to regional users.');
    }
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { orderId, id: poId, deletedAt: null },
      include: { checks: { orderBy: { checkKey: 'asc' } } },
    });
    if (!po) throw new NotFoundException('Purchase order not found.');
    if (!hasPermission(user.permissions, 'pricing.view')) {
      return {
        ...po,
        poItems: po.poItems,
        poTotal: null,
        taxTotal: null,
        unitRatesHidden: true,
        checks: po.checks.map((c) => ({
          key: c.checkKey,
          label: c.checkLabel,
          expected: c.expected,
          actual: c.actual,
          matched: c.matched,
          remark: c.remark,
        })),
      };
    }
    return po;
  }

  async poDecision(user: SessionUser, orderId: string, poId: string, dto: PoDecisionDto) {
    const order = await this.findScopedExisting(orderId);
    this.scope.assertCanView(order, user);
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { orderId, id: poId, deletedAt: null },
      include: { checks: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found.');
    if (po.status === 'SUPERSEDED' || po.status === 'VERIFIED') {
      throw new BadRequestException(`This PO has already been ${po.status.toLowerCase()} narratively.`);
    }
    return this.prisma.$transaction(async (tx) => {
      if (dto.action === 'raise_query') {
        await tx.purchaseOrder.update({
          where: { id: poId },
          data: { status: 'QUERY_RAISED' },
        });
        const to = await this.transitions.execute(tx, order, user, 'raise_po_query', {
          reason: dto.reason,
        });
        return { ok: true, status: to };
      }
      const mismatches = po.checks
        .filter((c) => !c.matched)
        .map((c) => `${c.checkLabel}: expected ${c.expected ?? '—'}, got ${c.actual ?? '—'}`);
      if (mismatches.length > 0 && !dto.overrideRemark?.trim()) {
        throw new UnprocessableEntityException(
          'Confirming a PO with mismatches requires an override remark.',
        );
      }
      await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          status: 'VERIFIED',
          verification: {
            action: 'confirm',
            at: new Date().toISOString(),
            mismatchCount: mismatches.length,
            overrideRemark: dto.overrideRemark ?? null,
            decisionsById: user.id,
          },
        },
      });
      const to = await this.transitions.execute(tx, order, user, 'confirm_order', {
        reason: dto.reason,
        comment: mismatches.length > 0 ? `Verified with overrides: ${dto.overrideRemark}` : undefined,
      });
      return { ok: true, status: to, verifiedPoId: poId };
    });
  }

  /** Generic transitions: fulfilment milestones + cancellation only. */
  async transition(user: SessionUser, orderId: string, dto: TransitionDto) {
    const DECLINED_IN_FAVOUR_OF = ['submit_requirement', 'upload_po', 'confirm_order'];
    const DIRECT = [
      'start_production',
      'start_qc',
      'dispatch',
      'mark_delivered',
      'cancel_order',
    ] as const;
    if (!(DIRECT as readonly string[]).includes(dto.action)) {
      throw new BadRequestException(
        `Use the dedicated endpoint for "${dto.action}"${DECLINED_IN_FAVOUR_OF.includes(dto.action) ? ' instead' : ''}.`,
      );
    }
    const order = await this.findScopedExisting(orderId);
    this.scope.assertCanView(order, user);
    const opts: TransitionOptions = { reason: dto.reason, comment: dto.comment };
    if (dto.action === 'dispatch') {
      const transporter = (dto.payload?.transporter as string | undefined)?.trim();
      const awb = (dto.payload?.awb as string | undefined)?.trim();
      if (!transporter || !awb) {
        throw new UnprocessableEntityException(
          'Transporter and AWB/consignment number are required to dispatch.',
        );
      }
      opts.comment = `${transporter} · AWB ${awb}`;
      opts.payload = { transporter, awb };
      opts.reason = undefined;
    }
    return this.prisma.$transaction(async (tx) => {
      const to = await this.transitions.execute(tx, order, user, dto.action, opts);
      return { ok: true, status: to };
    });
  }

  async orderAudit(user: SessionUser, orderId: string) {
    const order = await this.findScopedExisting(orderId);
    this.scope.assertCanView(order, user);
    const [logs, records] = await this.prisma.$transaction([
      this.prisma.orderStatusLog.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.auditRecord.findMany({
        where: { entityType: 'Order', entityId: orderId },
        orderBy: { createdAt: 'asc' },
        include: { actor: { select: { fullName: true, role: true } } },
      }),
    ]);
    return {
      statusLogs: logs.map((l) => ({ ...l, id: l.id.toString() })),
      auditRecords: records.map((r) => ({ ...r, id: r.id.toString() })),
    };
  }

  private async findScopedExisting(orderId: string) {
    if (!UUID_RE.test(orderId)) throw new NotFoundException('Order not found.');
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
    });
    if (!order) throw new NotFoundException('Order not found.');
    return order;
  }

  private async getQuotationOrThrow(quotationId: string) {
    if (!UUID_RE.test(quotationId)) throw new NotFoundException('Quotation not found.');
    const q = await this.prisma.quotation.findFirst({
      where: { id: quotationId, deletedAt: null },
      include: { order: true, items: true },
    });
    if (!q) throw new NotFoundException('Quotation not found.');
    return q;
  }

  private toVerifyQuotation(
    q: Prisma.QuotationGetPayload<{ include: { items: true } }>,
  ): VerifyQuotation {
    return {
      quotationRef: q.quotationRef,
      subTotal: q.subTotal ? Number(q.subTotal) : null,
      taxAmount: q.taxAmount ? Number(q.taxAmount) : null,
      totalAmount: q.totalAmount ? Number(q.totalAmount) : null,
      paymentTerms: q.paymentTerms,
      validityDate: q.validityDate,
      items: q.items.map((i) => ({
        description: i.description,
        specification: i.specification,
        quantity: Number(i.quantity),
        unit: i.unit,
        unitRate: Number(i.unitRate),
      })),
    };
  }

  private toVerifyPo(dto: UploadPoDto): VerifyPo {
    return {
      poNumber: dto.poNumber,
      poDate: dateOnly(dto.poDate),
      poTotal: dto.poTotal,
      taxTotal: dto.taxTotal ?? null,
      paymentTerms: dto.paymentTerms ?? null,
      externalRef: dto.externalRef ?? null,
      expectedDeliveryDate: dto.expectedDeliveryDate ? dateOnly(dto.expectedDeliveryDate) : null,
      items: dto.poItems.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unit: i.unit,
        unitRate: i.unitRate,
      })),
    };
  }
}

export interface ItemTotalsInput {
  quantity: number;
  unitRate: number;
  taxRatePct?: number;
}

export function computeTotals(items: ItemTotalsInput[]) {
  const amounts = items.map((i) => round2(i.quantity * i.unitRate));
  const subTotal = round2(amounts.reduce((a, b) => a + b, 0));
  const taxAmount = round2(
    items.reduce((sum, i) => sum + (i.taxRatePct ?? 0) * i.quantity * i.unitRate / 100, 0),
  );
  const total = round2(subTotal + taxAmount);
  return { amounts, subTotal, taxAmount, total };
}

export type { PoCheckRow };

import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { hasPermission } from '@pintoria/shared';
import type { SessionUser } from '../auth/auth.types';
import type { ListOrdersDto } from '../orders/dto/orders.dto';
import { buildOrderWhere } from '../orders/order-filters';
import { OrderScopeService } from '../orders/order-scope.service';
import { PrismaService } from '../prisma/prisma.service';

type ReportRow = Prisma.OrderGetPayload<{
  select: {
    orderNumber: true;
    title: true;
    status: true;
    itemName: true;
    quantity: true;
    unit: true;
    requestedDeliveryDate: true;
    createdAt: true;
    client: { select: { name: true; code: true } };
    region: { select: { name: true; code: true } };
    createdBy: { select: { fullName: true } };
    quotations: {
      select: { quotationRef: true; version: true; subTotal: true; taxAmount: true; totalAmount: true };
    };
    purchaseOrders: {
      select: { poNumber: true; poTotal: true; taxTotal: true };
    };
  };
}>;

const BASE_HEADERS = [
  'orderNumber',
  'title',
  'client',
  'region',
  'status',
  'itemName',
  'quantity',
  'unit',
  'requestedDeliveryDate',
  'createdAt',
  'createdBy',
] as const;

const PRICING_HEADERS = [
  'quotationRef',
  'quoteVersion',
  'subTotal',
  'taxAmount',
  'totalAmount',
  'poNumber',
  'poTaxTotal',
  'poTotal',
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dateCell(d: Date | string | null): string {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function latestQuotation(r: ReportRow) {
  return r.quotations.length > 0 ? r.quotations[0] : null;
}

function latestPo(r: ReportRow) {
  return r.purchaseOrders.length > 0 ? r.purchaseOrders[0] : null;
}

function baseRow(r: ReportRow): string[] {
  return [
    r.orderNumber,
    r.title,
    `${r.client.name} (${r.client.code})`,
    r.region ? `${r.region.name} (${r.region.code})` : '',
    r.status,
    r.itemName ?? '',
    r.quantity !== undefined && r.quantity !== null ? String(r.quantity) : '',
    r.unit ?? '',
    r.requestedDeliveryDate ? r.requestedDeliveryDate.toISOString().slice(0, 10) : '',
    dateCell(r.createdAt),
    r.createdBy?.fullName ?? '',
  ];
}

function pricingRow(r: ReportRow): string[] {
  const q = latestQuotation(r);
  const po = latestPo(r);
  return [
    q ? q.quotationRef : '',
    q ? String(q.version) : '',
    q && q.subTotal !== null ? String(q.subTotal) : '',
    q && q.taxAmount !== null ? String(q.taxAmount) : '',
    q && q.totalAmount !== null ? String(q.totalAmount) : '',
    po ? po.poNumber : '',
    po && po.taxTotal !== null ? String(po.taxTotal) : '',
    po ? String(po.poTotal) : '',
  ];
}

function toCsv(headers: readonly string[], rows: string[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  // BOM so Excel opens the file as UTF-8
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Order report export. Same scoping as GET /orders; the CSV only includes
 *  pricing/commercial columns for callers with `pricing.view` — a regional
 *  user's download never contains rate,total or tax data at all. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OrderScopeService,
  ) {}

  async ordersCsv(user: SessionUser, q: ListOrdersDto): Promise<{ csv: string; filename: string }> {
    if (q.format && q.format !== 'csv') {
      throw new BadRequestException('Only format=csv is supported right now.');
    }
    const where: Prisma.OrderWhereInput = buildOrderWhere(this.scope, user, q);
    const orders = await this.prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { orderNumber: 'desc' }],
      select: {
        orderNumber: true,
        title: true,
        status: true,
        itemName: true,
        quantity: true,
        unit: true,
        requestedDeliveryDate: true,
        createdAt: true,
        client: { select: { name: true, code: true } },
        region: { select: { name: true, code: true } },
        createdBy: { select: { fullName: true } },
        quotations: {
          where: { deletedAt: null },
          orderBy: { version: 'desc' },
          take: 1,
          select: { quotationRef: true, version: true, subTotal: true, taxAmount: true, totalAmount: true },
        },
        purchaseOrders: {
          where: { deletedAt: null },
          orderBy: { uploadedAt: 'desc' },
          take: 1,
          select: { poNumber: true, poTotal: true, taxTotal: true },
        },
      },
    });

    const canSeePricing = hasPermission(user.permissions, 'pricing.view');
    const headers = [...BASE_HEADERS, ...(canSeePricing ? PRICING_HEADERS : [])];
    const table = orders.map((r) => [...baseRow(r), ...(canSeePricing ? pricingRow(r) : [])]);
    const csv = toCsv(headers, table);
    const filename = `pintoria-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    return { csv, filename };
  }
}

/* Seed: demo data for development/test environments.
 * REFUSES to run when NODE_ENV=production (see README).
 * Run: npm run db:migrate (first time) or npm run db:reset.
 */
import { PrismaClient, OrderStatus, QuotationStatus, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SEED_PASSWORD = 'Printoria@2024';

function die(msg: string): never {
  console.error(`Seed aborted: ${msg}`);
  process.exit(1);
}

function daysAgo(n: number, h = 0): Date {
  return new Date(Date.now() - n * 86400000 - h * 3600000);
}

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function futureDate(daysFromNow: number): Date {
  return dateOnly(new Date(Date.now() + daysFromNow * 86400000));
}

type LogInline = {
  from: OrderStatus | null;
  to: OrderStatus;
  action: string;
  role: UserRole;
  actor: string; // email of actor (resolved later)
  reason?: string;
  comment?: string;
  at: Date;
};

type QuoteItemInline = {
  description: string;
  specification: string;
  quantity: number;
  unit: string;
  unitRate: number;
  taxRatePct: number;
  amount: number;
};

type Scenario = {
  clientCode: string;
  regionCode: string;
  createdByEmail: string;
  orderNumber: string;
  title: string;
  requirement: {
    itemName: string;
    specification: string;
    quantity: number;
    unit: string;
    requestedDeliveryDate: Date;
    notes?: string;
  };
  extraRequirementVersions?: Array<{
    itemName: string;
    specification: string;
    quantity: number;
    unit: string;
    requestedDeliveryDate: Date;
    notes?: string;
  }>;
  statuses: {
    finalStatus: OrderStatus;
    // Ordered chain of transitions; the order's statusEnteredAt = last entry time
    logs: LogInline[];
  };
  quotation?: {
    version: number;
    status: QuotationStatus;
    decision?: unknown;
    validityDate: Date;
    items: QuoteItemInline[];
  };
  po?: {
    poNumber: string;
    poDate: Date;
    expectedDeliveryDate: Date;
    items: Array<{ description: string; quantity: number; unit: string; unitRate: number }>;
    poTotal: number;
    taxTotal: number;
    paymentTerms: string;
    status: string;
    verification?: unknown;
  };
  cancellation?: unknown;
  closedAt?: Date;
};

const emailByCode: Record<string, string> = {
  aWestRegional: 'regional.west@sunlightfoods.example',
  aNorthRegional: 'regional.north@sunlightfoods.example',
  aHo: 'ho@sunlightfoods.example',
  bSouthRegional: 'regional.south@nimbusretail.example',
  bHo: 'ho@nimbusretail.example',
  ptSales: 'pt.sales@printoria.example',
  ptOps: 'pt.ops@printoria.example',
};

const SCENARIOS: Scenario[] = [
  {
    clientCode: 'SUNLIGHT',
    regionCode: 'WST',
    createdByEmail: emailByCode.aWestRegional,
    orderNumber: 'PRT-1001',
    title: 'Diwali gift cartons — 2026',
    requirement: {
      itemName: 'Folding cartons, 250gsm',
      specification: '4-colour offset, matte lamination, 180x120x60mm, gold foil logo',
      quantity: 5000,
      unit: 'pcs',
      requestedDeliveryDate: futureDate(18),
      notes: 'Deliver to Mumbai warehouse; packing in 100s.',
    },
    statuses: {
      finalStatus: OrderStatus.SUBMITTED,
      logs: [{ from: null, to: OrderStatus.SUBMITTED, action: 'submit_requirement', role: 'CLIENT_REGIONAL', actor: emailByCode.aWestRegional, at: daysAgo(2, 3) }],
    },
  },
  {
    clientCode: 'SUNLIGHT',
    regionCode: 'NTH',
    createdByEmail: emailByCode.aNorthRegional,
    orderNumber: 'PRT-1002',
    title: 'Spice range pouches',
    requirement: {
      itemName: 'Stand-up pouches, Everest spec',
      specification: '5-ply laminate, zip lock, 250/500g variants',
      quantity: 8000,
      unit: 'pcs',
      requestedDeliveryDate: futureDate(25),
      notes: 'Mixed packing required.',
    },
    extraRequirementVersions: [
      {
        itemName: 'Stand-up pouches, Everest spec',
        specification: '5-ply laminate, zip lock, 250/500g variants',
        quantity: 8000,
        unit: 'pcs',
        requestedDeliveryDate: futureDate(25),
      },
    ],
    statuses: {
      finalStatus: OrderStatus.RETURNED_FOR_CLARIFICATION,
      logs: [
        { from: null, to: OrderStatus.SUBMITTED, action: 'submit_requirement', role: 'CLIENT_REGIONAL', actor: emailByCode.aNorthRegional, at: daysAgo(6, 5) },
        {
          from: OrderStatus.SUBMITTED,
          to: OrderStatus.RETURNED_FOR_CLARIFICATION,
          action: 'return_for_clarification',
          role: 'CLIENT_HEAD_OFFICE',
          actor: emailByCode.aHo,
          reason: 'Quantity unclear',
          comment: 'Is 8000 pcs for both 250g and 500g sizes combined? Please split and confirm.',
          at: daysAgo(5, 2),
        },
      ],
    },
  },
  {
    clientCode: 'SUNLIGHT',
    regionCode: 'WST',
    createdByEmail: emailByCode.aWestRegional,
    orderNumber: 'PRT-1003',
    title: 'Bottle hanger cards',
    requirement: {
      itemName: 'Hanger cards 350gsm',
      specification: '4-colour, spot UV, die-cut neck hole, 90x130mm',
      quantity: 12000,
      unit: 'pcs',
      requestedDeliveryDate: futureDate(20),
    },
    statuses: {
      finalStatus: OrderStatus.QUOTATION_SUBMITTED,
      logs: [
        { from: null, to: OrderStatus.SUBMITTED, action: 'submit_requirement', role: 'CLIENT_REGIONAL', actor: emailByCode.aWestRegional, at: daysAgo(4, 2) },
        { from: OrderStatus.SUBMITTED, to: OrderStatus.QUOTATION_IN_PROGRESS, action: 'approve_requirement', role: 'CLIENT_HEAD_OFFICE', actor: emailByCode.aHo, at: daysAgo(3, 4) },
        { from: OrderStatus.QUOTATION_IN_PROGRESS, to: OrderStatus.QUOTATION_SUBMITTED, action: 'submit_quotation', role: 'PRINTORIA_SALES', actor: emailByCode.ptSales, at: daysAgo(1, 6) },
      ],
    },
    quotation: {
      version: 1,
      status: QuotationStatus.SUBMITTED,
      validityDate: futureDate(15),
      items: [
        {
          description: 'Hanger cards 350gsm',
          specification: '4-colour, spot UV, die-cut',
          quantity: 12000,
          unit: 'pcs',
          unitRate: 3.9,
          taxRatePct: 18,
          amount: 46800,
        },
        {
          description: 'Printing plates',
          specification: 'One-time tooling',
          quantity: 2,
          unit: 'nos',
          unitRate: 2500,
          taxRatePct: 18,
          amount: 5000,
        },
      ],
    },
  },
  {
    clientCode: 'SUNLIGHT',
    regionCode: 'WST',
    createdByEmail: emailByCode.aWestRegional,
    orderNumber: 'PRT-1004',
    title: 'Promotional posters 24x36',
    requirement: {
      itemName: 'Offset posters 24x36in',
      specification: '170gsm art paper, 4-colour, single side',
      quantity: 2000,
      unit: 'pcs',
      requestedDeliveryDate: futureDate(22),
    },
    statuses: {
      finalStatus: OrderStatus.AWAITING_PO,
      logs: [
        { from: null, to: OrderStatus.SUBMITTED, action: 'submit_requirement', role: 'CLIENT_REGIONAL', actor: emailByCode.aWestRegional, at: daysAgo(8, 1) },
        { from: OrderStatus.SUBMITTED, to: OrderStatus.QUOTATION_IN_PROGRESS, action: 'approve_requirement', role: 'CLIENT_HEAD_OFFICE', actor: emailByCode.aHo, at: daysAgo(7, 3) },
        { from: OrderStatus.QUOTATION_IN_PROGRESS, to: OrderStatus.QUOTATION_SUBMITTED, action: 'submit_quotation', role: 'PRINTORIA_SALES', actor: emailByCode.ptSales, at: daysAgo(5, 5) },
        {
          from: OrderStatus.QUOTATION_SUBMITTED,
          to: OrderStatus.AWAITING_PO,
          action: 'approve_quotation',
          role: 'CLIENT_HEAD_OFFICE',
          actor: emailByCode.aHo,
          at: daysAgo(4, 4),
        },
      ],
    },
    quotation: {
      version: 1,
      status: QuotationStatus.APPROVED,
      decision: { action: 'approve', comment: 'Rates approved, proceed with PO.' },
      validityDate: futureDate(30),
      items: [
        {
          description: 'Offset posters 24x36in',
          specification: '170gsm art paper',
          quantity: 2000,
          unit: 'pcs',
          unitRate: 22.5,
          taxRatePct: 18,
          amount: 45000,
        },
      ],
    },
  },
  {
    clientCode: 'SUNLIGHT',
    regionCode: 'NTH',
    createdByEmail: emailByCode.aNorthRegional,
    orderNumber: 'PRT-1005',
    title: 'Courier mailers 4x6in',
    requirement: {
      itemName: 'Courier bags 4x6in',
      specification: '60gsm tamper-proof poly, printed 1 colour',
      quantity: 50000,
      unit: 'pcs',
      requestedDeliveryDate: futureDate(16),
    },
    statuses: {
      finalStatus: OrderStatus.PO_RECEIVED,
      logs: [
        { from: null, to: OrderStatus.SUBMITTED, action: 'submit_requirement', role: 'CLIENT_REGIONAL', actor: emailByCode.aNorthRegional, at: daysAgo(9, 2) },
        { from: OrderStatus.SUBMITTED, to: OrderStatus.QUOTATION_IN_PROGRESS, action: 'approve_requirement', role: 'CLIENT_HEAD_OFFICE', actor: emailByCode.aHo, at: daysAgo(8, 0) },
        { from: OrderStatus.QUOTATION_IN_PROGRESS, to: OrderStatus.QUOTATION_SUBMITTED, action: 'submit_quotation', role: 'PRINTORIA_SALES', actor: emailByCode.ptSales, at: daysAgo(6, 3) },
        { from: OrderStatus.QUOTATION_SUBMITTED, to: OrderStatus.AWAITING_PO, action: 'approve_quotation', role: 'CLIENT_HEAD_OFFICE', actor: emailByCode.aHo, at: daysAgo(5, 1) },
        { from: OrderStatus.AWAITING_PO, to: OrderStatus.PO_RECEIVED, action: 'upload_po', role: 'CLIENT_HEAD_OFFICE', actor: emailByCode.aHo, comment: 'PO SUN/NBO/2026/0119 attached.', at: daysAgo(2, 6) },
      ],
    },
    quotation: {
      version: 1,
      status: QuotationStatus.APPROVED,
      decision: { action: 'approve' },
      validityDate: futureDate(21),
      items: [
        {
          description: 'Courier bags 4x6in',
          specification: '60gsm tamper-proof poly',
          quantity: 50000,
          unit: 'pcs',
          unitRate: 1.44,
          taxRatePct: 12,
          amount: 72000,
        },
      ],
    },
    po: {
      poNumber: 'SUN/NBO/2026/0119',
      poDate: daysAgo(2, 10),
      expectedDeliveryDate: futureDate(16),
      items: [{ description: 'Courier bags 4x6in', quantity: 50000, unit: 'pcs', unitRate: 1.44 }],
      poTotal: 72000,
      taxTotal: 8640,
      paymentTerms: '30 days from invoice',
      status: 'PENDING_VERIFICATION',
    },
  },
  {
    clientCode: 'SUNLIGHT',
    regionCode: 'WST',
    createdByEmail: emailByCode.aWestRegional,
    orderNumber: 'PRT-1006',
    title: 'Hang tags with brass eyelet',
    requirement: {
      itemName: 'Hang tags, brass eyelet',
      specification: '600gsm grey-back board, 4-colour, 1” brass eyelet, waxed thread',
      quantity: 30000,
      unit: 'pcs',
      requestedDeliveryDate: futureDate(14),
    },
    statuses: {
      finalStatus: OrderStatus.ORDER_CONFIRMED,
      logs: [
        { from: null, to: OrderStatus.SUBMITTED, action: 'submit_requirement', role: 'CLIENT_REGIONAL', actor: emailByCode.aWestRegional, at: daysAgo(11, 4) },
        { from: OrderStatus.SUBMITTED, to: OrderStatus.QUOTATION_IN_PROGRESS, action: 'approve_requirement', role: 'CLIENT_HEAD_OFFICE', actor: emailByCode.aHo, at: daysAgo(10, 2) },
        { from: OrderStatus.QUOTATION_IN_PROGRESS, to: OrderStatus.QUOTATION_SUBMITTED, action: 'submit_quotation', role: 'PRINTORIA_SALES', actor: emailByCode.ptSales, at: daysAgo(9, 6) },
        { from: OrderStatus.QUOTATION_SUBMITTED, to: OrderStatus.AWAITING_PO, action: 'approve_quotation', role: 'CLIENT_HEAD_OFFICE', actor: emailByCode.aHo, at: daysAgo(8, 5) },
        { from: OrderStatus.AWAITING_PO, to: OrderStatus.PO_RECEIVED, action: 'upload_po', role: 'CLIENT_HEAD_OFFICE', actor: emailByCode.aHo, comment: 'PO SUN/NBO/2026/0102 attached.', at: daysAgo(6, 2) },
        { from: OrderStatus.PO_RECEIVED, to: OrderStatus.ORDER_CONFIRMED, action: 'confirm_order', role: 'PRINTORIA_OPS', actor: emailByCode.ptOps, comment: 'PO verified against quotation v1. Green checklist.', at: daysAgo(5, 3) },
      ],
    },
    quotation: {
      version: 1,
      status: QuotationStatus.APPROVED,
      decision: { action: 'approve' },
      validityDate: futureDate(28),
      items: [
        {
          description: 'Hang tags, 600gsm, brass eyelet',
          specification: '4-colour, thread included',
          quantity: 30000,
          unit: 'pcs',
          unitRate: 2.1,
          taxRatePct: 18,
          amount: 63000,
        },
      ],
    },
    po: {
      poNumber: 'SUN/NBO/2026/0102',
      poDate: daysAgo(6, 8),
      expectedDeliveryDate: futureDate(14),
      items: [{ description: 'Hang tags, 600gsm, brass eyelet', quantity: 30000, unit: 'pcs', unitRate: 2.1 }],
      poTotal: 63000,
      taxTotal: 11340,
      paymentTerms: '45 days from invoice',
      status: 'VERIFIED',
      verification: {
        confirmedAt: daysAgo(5, 3).toISOString(),
        mismatches: 0,
        overrideRemark: null,
      },
    },
  },
  {
    clientCode: 'NIMBUS',
    regionCode: 'STH',
    createdByEmail: emailByCode.bSouthRegional,
    orderNumber: 'PRT-1007',
    title: 'Corrugated shippers 5-ply',
    requirement: {
      itemName: 'Corrugated shippers 5-ply',
      specification: 'Brown kraft, 5-ply, 450x350x300mm, flexo 1 colour',
      quantity: 15000,
      unit: 'pcs',
      requestedDeliveryDate: futureDate(7),
    },
    statuses: {
      finalStatus: OrderStatus.DELIVERED_CLOSED,
      logs: [
        { from: null, to: OrderStatus.SUBMITTED, action: 'submit_requirement', role: 'CLIENT_REGIONAL', actor: emailByCode.bSouthRegional, at: daysAgo(21, 2) },
        { from: OrderStatus.SUBMITTED, to: OrderStatus.QUOTATION_IN_PROGRESS, action: 'approve_requirement', role: 'CLIENT_HEAD_OFFICE', actor: emailByCode.bHo, at: daysAgo(20, 1) },
        { from: OrderStatus.QUOTATION_IN_PROGRESS, to: OrderStatus.QUOTATION_SUBMITTED, action: 'submit_quotation', role: 'PRINTORIA_SALES', actor: emailByCode.ptSales, at: daysAgo(18, 5) },
        { from: OrderStatus.QUOTATION_SUBMITTED, to: OrderStatus.AWAITING_PO, action: 'approve_quotation', role: 'CLIENT_HEAD_OFFICE', actor: emailByCode.bHo, at: daysAgo(17, 4) },
        { from: OrderStatus.AWAITING_PO, to: OrderStatus.PO_RECEIVED, action: 'upload_po', role: 'CLIENT_HEAD_OFFICE', actor: emailByCode.bHo, comment: 'PO NIM/CHN/2026/0033 attached.', at: daysAgo(15, 3) },
        { from: OrderStatus.PO_RECEIVED, to: OrderStatus.ORDER_CONFIRMED, action: 'confirm_order', role: 'PRINTORIA_OPS', actor: emailByCode.ptOps, at: daysAgo(14, 3) },
        { from: OrderStatus.ORDER_CONFIRMED, to: OrderStatus.IN_PRODUCTION, action: 'start_production', role: 'PRINTORIA_OPS', actor: emailByCode.ptOps, at: daysAgo(12, 3) },
        { from: OrderStatus.IN_PRODUCTION, to: OrderStatus.QUALITY_CHECK, action: 'start_qc', role: 'PRINTORIA_OPS', actor: emailByCode.ptOps, at: daysAgo(10, 3) },
        { from: OrderStatus.QUALITY_CHECK, to: OrderStatus.DISPATCHED, action: 'dispatch', role: 'PRINTORIA_OPS', actor: emailByCode.ptOps, comment: 'LR GATI-4471902', at: daysAgo(8, 3) },
        { from: OrderStatus.DISPATCHED, to: OrderStatus.DELIVERED_CLOSED, action: 'mark_delivered', role: 'PRINTORIA_OPS', actor: emailByCode.ptOps, at: daysAgo(7, 1) },
      ],
    },
    quotation: {
      version: 1,
      status: QuotationStatus.APPROVED,
      decision: { action: 'approve' },
      validityDate: new Date(Date.now() - 5 * 86400000),
      items: [
        {
          description: 'Corrugated shippers 5-ply',
          specification: '450x350x300mm, flexo 1 colour',
          quantity: 15000,
          unit: 'pcs',
          unitRate: 38.0,
          taxRatePct: 12,
          amount: 570000,
        },
      ],
    },
    po: {
      poNumber: 'NIM/CHN/2026/0033',
      poDate: daysAgo(15, 6),
      expectedDeliveryDate: futureDate(10),
      items: [{ description: 'Corrugated shippers 5-ply', quantity: 15000, unit: 'pcs', unitRate: 38.0 }],
      poTotal: 570000,
      taxTotal: 68400,
      paymentTerms: '30 days from invoice',
      status: 'VERIFIED',
      verification: { confirmedAt: daysAgo(14, 3).toISOString(), mismatches: 0, overrideRemark: null },
    },
    closedAt: daysAgo(7, 1),
  },
  {
    clientCode: 'NIMBUS',
    regionCode: 'ESK',
    createdByEmail: emailByCode.bSouthRegional,
    orderNumber: 'PRT-1008',
    title: 'Kraft paper bags',
    requirement: {
      itemName: 'Kraft paper bags 240gsm',
      specification: 'Twisted rope handles, 260x300x110mm, 1-colour logo',
      quantity: 25000,
      unit: 'pcs',
      requestedDeliveryDate: futureDate(19),
    },
    statuses: {
      finalStatus: OrderStatus.CANCELLED,
      logs: [
        { from: null, to: OrderStatus.SUBMITTED, action: 'submit_requirement', role: 'CLIENT_REGIONAL', actor: emailByCode.bSouthRegional, at: daysAgo(7, 6) },
        { from: OrderStatus.SUBMITTED, to: OrderStatus.QUOTATION_IN_PROGRESS, action: 'approve_requirement', role: 'CLIENT_HEAD_OFFICE', actor: emailByCode.bHo, at: daysAgo(6, 5) },
        { from: OrderStatus.QUOTATION_IN_PROGRESS, to: OrderStatus.QUOTATION_SUBMITTED, action: 'submit_quotation', role: 'PRINTORIA_SALES', actor: emailByCode.ptSales, at: daysAgo(5, 2) },
        { from: OrderStatus.QUOTATION_SUBMITTED, to: OrderStatus.AWAITING_PO, action: 'approve_quotation', role: 'CLIENT_HEAD_OFFICE', actor: emailByCode.bHo, at: daysAgo(4, 2) },
        {
          from: OrderStatus.AWAITING_PO,
          to: OrderStatus.CANCELLED,
          action: 'cancel_order',
          role: 'CLIENT_HEAD_OFFICE',
          actor: emailByCode.bHo,
          reason: 'Product line cancelled',
          comment: 'SKU withdrawn by merchandising.',
          at: daysAgo(2, 4),
        },
      ],
    },
    quotation: {
      version: 1,
      status: QuotationStatus.APPROVED,
      decision: { action: 'approve' },
      validityDate: futureDate(24),
      items: [
        {
          description: 'Kraft paper bags 240gsm',
          specification: 'Rope handles, 260x300x110mm',
          quantity: 25000,
          unit: 'pcs',
          unitRate: 9.8,
          taxRatePct: 12,
          amount: 245000,
        },
      ],
    },
    cancellation: {
      byRole: 'CLIENT_HEAD_OFFICE',
      reason: 'Product line cancelled',
      at: daysAgo(2, 4).toISOString(),
    },
  },
];

async function wipe() {
  await prisma.$transaction([
    prisma.notificationLog.deleteMany(),
    prisma.orderStatusLog.deleteMany(),
    prisma.auditRecord.deleteMany(),
    prisma.poCheckItem.deleteMany(),
    prisma.purchaseOrder.deleteMany(),
    prisma.quotationItem.deleteMany(),
    prisma.quotation.deleteMany(),
    prisma.requirementVersion.deleteMany(),
    prisma.file.deleteMany(),
    prisma.order.deleteMany(),
    prisma.authToken.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.clientContact.deleteMany(),
    prisma.clientNotificationPrefs.deleteMany(),
    prisma.orderNumberSequence.deleteMany(),
    prisma.setting.deleteMany(),
    prisma.user.deleteMany(),
    prisma.region.deleteMany(),
    prisma.client.deleteMany(),
  ]);
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    die('seeding is not allowed when NODE_ENV=production');
  }

  console.log('Wiping existing data…');
  await wipe();

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);

  console.log('Seeding settings…');
  await prisma.setting.createMany({
    data: [
      {
        key: 'delay_threshold_hours',
        value: { default: 48, perStage: { ORDER_CONFIRMED: 72, PO_RECEIVED: 24 } },
      },
      {
        key: 'cancellation_rules',
        value: {
          clientHoUntil: 'PO_RECEIVED',
          printoriaOpsUntil: 'QUALITY_CHECK',
          chargesAfterPo: true,
          regionalMayCancel: true,
        },
      },
      {
        key: 'post_confirmation_changes',
        value: { allowQty: false, allowSpec: false, requireReason: true },
      },
      {
        key: 'fulfilment_visibility',
        value: {
          showToClient: true,
          visibleStatuses: ['IN_PRODUCTION', 'QUALITY_CHECK', 'DISPATCHED'],
        },
      },
      {
        key: 'notifications',
        value: {
          email: true,
          whatsapp: true,
          reminderIntervalHours: 24,
          criticalAlwaysSend: true,
        },
      },
      {
        key: 'uploads',
        value: { maxMb: 25, allowedExt: ['pdf', 'jpg', 'jpeg', 'png', 'xlsx', 'docx', 'ai', 'cdr'] },
      },
    ],
  });

  console.log('Seeding clients & regions…');
  const sunlight = await prisma.client.create({
    data: {
      name: 'Sunlight Foods & Beverages Pvt Ltd',
      registeredName: 'Sunlight Foods & Beverages Private Limited',
      code: 'SUNLIGHT',
      industry: 'FMCG — beverages & packaged foods',
      clientSince: new Date('2021-04-01'),
      website: 'https://sunlightfoods.example',
      businessEmail: 'procurement@sunlightfoods.example',
      phone: '+91 22 4000 1234',
      gstin: '27AAECS1234F1Z5',
      pan: 'AAECS1234F',
      cin: 'U15511MH2011PTC222222',
      paymentTerms: 'Net 30 days from invoice',
      registeredAddress: 'Plot 14, MIDC Industrial Estate, Andheri East',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400093',
      billingAddress: 'Finance Department, 9th Floor, Trade Prism, Bandra Kurla Complex, Mumbai 400051',
    },
  });
  const nimbus = await prisma.client.create({
    data: {
      name: 'Nimbus Retail Ventures Pvt Ltd',
      registeredName: 'Nimbus Retail Ventures Private Limited',
      code: 'NIMBUS',
      industry: 'Retail — fashion & lifestyle',
      clientSince: new Date('2019-10-15'),
      website: 'https://nimbusretail.example',
      businessEmail: 'stores.supply@nimbusretail.example',
      phone: '+91 44 6123 5678',
      gstin: '33AAGCN9876K1Z2',
      pan: 'AAGCN9876K',
      cin: 'U52100TN2019PTC111111',
      paymentTerms: 'Net 45 days from invoice',
      registeredAddress: 'No. 62, Anna Salai, Teynampet',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600018',
      billingAddress: 'Accounts Payable, Nimbus House, Perungudi, Chennai 600096',
    },
  });

  const sunlightWest = await prisma.region.create({
    data: {
      clientId: sunlight.id,
      name: 'West — Mumbai',
      code: 'WST',
      city: 'Mumbai',
      managerName: 'Kavita Shetty',
      managerEmail: 'regional.west@sunlightfoods.example',
    },
  });
  const sunlightNorth = await prisma.region.create({
    data: {
      clientId: sunlight.id,
      name: 'North — Delhi',
      code: 'NTH',
      city: 'Delhi',
      managerName: 'Arjun Mehta',
      managerEmail: 'regional.north@sunlightfoods.example',
    },
  });
  const nimbusSouth = await prisma.region.create({
    data: {
      clientId: nimbus.id,
      name: 'South — Chennai',
      code: 'STH',
      city: 'Chennai',
      managerName: 'Deepa Krishnan',
      managerEmail: 'regional.south@nimbusretail.example',
    },
  });
  const nimbusEast = await prisma.region.create({
    data: {
      clientId: nimbus.id,
      name: 'East — Kolkata',
      code: 'ESK',
      city: 'Kolkata',
      managerName: 'Sourav Ganguly',
      managerEmail: 'regional.east@nimbusretail.example',
    },
  });

  console.log('Seeding users…');
  const users: Record<string, { id: string }> = {};
  const userSeeds: Array<{
    code: string;
    clientId: string | null;
    regionId: string | null;
    role: UserRole;
    email: string;
    fullName: string;
    phone: string;
    pricingView: boolean;
  }> = [
    { code: 'ptAdmin', clientId: null, regionId: null, role: 'PRINTORIA_ADMIN', email: 'pt.admin@printoria.example', fullName: 'Asha Vaidya', phone: '+91 98200 11223', pricingView: true },
    { code: 'ptSales', clientId: null, regionId: null, role: 'PRINTORIA_SALES', email: 'pt.sales@printoria.example', fullName: 'Rohit Menon', phone: '+91 98200 22334', pricingView: true },
    { code: 'ptOps', clientId: null, regionId: null, role: 'PRINTORIA_OPS', email: 'pt.ops@printoria.example', fullName: 'Aniket Rao', phone: '+91 98200 33445', pricingView: false },
    { code: 'aWestRegional', clientId: sunlight.id, regionId: sunlightWest.id, role: 'CLIENT_REGIONAL', email: 'regional.west@sunlightfoods.example', fullName: 'Kavita Shetty', phone: '+91 90040 55661', pricingView: false },
    { code: 'aNorthRegional', clientId: sunlight.id, regionId: sunlightNorth.id, role: 'CLIENT_REGIONAL', email: 'regional.north@sunlightfoods.example', fullName: 'Arjun Mehta', phone: '+91 90040 55662', pricingView: false },
    { code: 'aHo', clientId: sunlight.id, regionId: null, role: 'CLIENT_HEAD_OFFICE', email: 'ho@sunlightfoods.example', fullName: 'Rajan Gupta', phone: '+91 90040 55663', pricingView: true },
    { code: 'bSouthRegional', clientId: nimbus.id, regionId: nimbusSouth.id, role: 'CLIENT_REGIONAL', email: 'regional.south@nimbusretail.example', fullName: 'Deepa Krishnan', phone: '+91 90040 55664', pricingView: false },
    { code: 'bHo', clientId: nimbus.id, regionId: null, role: 'CLIENT_HEAD_OFFICE', email: 'ho@nimbusretail.example', fullName: 'Priya Varma', phone: '+91 90040 55665', pricingView: true },
    {
      code: 'bHo2Invited',
      clientId: nimbus.id,
      regionId: nimbusEast.id,
      role: 'CLIENT_HEAD_OFFICE',
      email: 'ho2.pending@nimbusretail.example',
      fullName: 'Vacant — East HO (invite pending)',
      phone: '',
      pricingView: true,
    },
  ];

  for (const u of userSeeds) {
    const created = await prisma.user.create({
      data: {
        clientId: u.clientId,
        regionId: u.regionId,
        role: u.role,
        email: u.email,
        fullName: u.fullName,
        phone: u.phone || null,
        pricingView: u.pricingView,
        passwordHash:
          u.code === 'bHo2Invited'
            ? await bcrypt.hash(randomUnusable(), 12)
            : passwordHash,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    users[u.code] = created;
  }

  const userByEmail = new Map<string, string>(
    userSeeds.map((u) => [u.email, users[u.code].id]),
  );

  console.log('Seeding contacts & alert preferences…');
  await prisma.clientContact.createMany({
    data: [
      { clientId: sunlight.id, name: 'Meera Iyer', roleName: 'Procurement Head', email: 'ho@sunlightfoods.example', phone: '+91 98330 70001' },
      { clientId: sunlight.id, name: 'Sunil Bhatia', roleName: 'Finance Controller', email: 'finance@sunlightfoods.example', phone: '+91 98330 70002' },
      { clientId: nimbus.id, name: 'Priya Varma', roleName: 'Packaging Lead', email: 'ho@nimbusretail.example', phone: '+91 98410 70003' },
      { clientId: nimbus.id, name: 'Nikhil Shetty', roleName: 'Store Ops Head', email: 'stores@nimbusretail.example', phone: '+91 98410 70004' },
    ],
  });
  await prisma.clientNotificationPrefs.createMany({
    data: [
      { clientId: sunlight.id, emailAlerts: true, whatsappAlerts: true, dailyPendingReminder: true },
      { clientId: nimbus.id, emailAlerts: true, whatsappAlerts: true, dailyPendingReminder: true },
    ],
  });

  console.log('Seeding demo orders…');
  for (const s of SCENARIOS) {
    const createdById = userByEmail.get(s.createdByEmail);
    if (!createdById) die(`actor ${s.createdByEmail} not seeded`);

    const clientId = s.clientCode === 'SUNLIGHT' ? sunlight.id : nimbus.id;
    const regionId =
      s.regionCode === 'WST'
        ? sunlightWest.id
        : s.regionCode === 'NTH'
          ? sunlightNorth.id
          : s.regionCode === 'STH'
            ? nimbusSouth.id
            : nimbusEast.id;

    const lastLog = s.statuses.logs[s.statuses.logs.length - 1];
    const statusEnteredAt = lastLog.at;

    const order = await prisma.order.create({
      data: {
        orderNumber: s.orderNumber,
        clientId,
        regionId,
        createdById,
        title: s.title,
        status: s.statuses.finalStatus,
        statusEnteredAt,
        itemName: s.requirement.itemName,
        quantity: s.requirement.quantity,
        unit: s.requirement.unit,
        requestedDeliveryDate: s.requirement.requestedDeliveryDate,
        cancellation: s.cancellation ?? undefined,
        closedAt: s.closedAt ?? undefined,
      },
      select: { id: true },
    });

    await prisma.requirementVersion.create({
      data: {
        orderId: order.id,
        version: 1,
        itemName: s.requirement.itemName,
        specification: s.requirement.specification,
        quantity: s.requirement.quantity,
        unit: s.requirement.unit,
        requestedDeliveryDate: s.requirement.requestedDeliveryDate,
        notes: s.requirement.notes ?? null,
        submittedById: createdById,
        submittedAt: s.statuses.logs[0].at,
      },
    });

    if (s.extraRequirementVersions) {
      for (let i = 0; i < s.extraRequirementVersions.length; i++) {
        const rv = s.extraRequirementVersions[i];
        await prisma.requirementVersion.create({
          data: {
            orderId: order.id,
            version: i + 2,
            itemName: rv.itemName,
            specification: rv.specification,
            quantity: rv.quantity,
            unit: rv.unit,
            requestedDeliveryDate: rv.requestedDeliveryDate,
            notes: rv.notes ?? null,
            submittedById: createdById,
            submittedAt: s.statuses.logs[s.statuses.logs.length - 2]?.at ?? statusEnteredAt,
          },
        });
      }
    }

    if (s.quotation) {
      const subTotal = s.quotation.items.reduce((a, i) => a + i.amount, 0);
      const taxAmount = Math.round(
        (subTotal * s.quotation.items.reduce((a, i) => a + i.taxRatePct, 0)) /
          s.quotation.items.length /
          100,
      );
      const quotation = await prisma.quotation.create({
        data: {
          orderId: order.id,
          version: s.quotation.version,
          quotationRef: `${s.orderNumber.replace('PRT-', 'QTN-')}-v${s.quotation.version}`,
          subTotal,
          taxAmount,
          totalAmount: subTotal + taxAmount,
          validityDate: s.quotation.validityDate,
          status: s.quotation.status,
          submittedById: s.quotation.status === 'DRAFT' ? null : userByEmail.get(emailByCode.ptSales)!,
          submittedAt:
            s.quotation.status === 'DRAFT'
              ? null
              : (s.statuses.logs.find((l) => l.action === 'submit_quotation')?.at ?? statusEnteredAt),
          decision: s.quotation.decision === undefined ? undefined : (s.quotation.decision as object),
        },
        select: { id: true },
      });
      await prisma.quotationItem.createMany({
        data: s.quotation.items.map((i) => ({ ...i, quotationId: quotation.id })),
      });
    }

    if (s.po) {
      const po = await prisma.purchaseOrder.create({
        data: {
          orderId: order.id,
          poNumber: s.po.poNumber,
          poDate: s.po.poDate,
          poItems: s.po.items,
          poTotal: s.po.poTotal,
          taxTotal: s.po.taxTotal,
          paymentTerms: s.po.paymentTerms,
          expectedDeliveryDate: s.po.expectedDeliveryDate,
          status: s.po.status,
          verification: (s.po.verification as object) ?? undefined,
          uploadedById: userByEmail.get(emailByCode.aHo)!,
          uploadedAt: s.po.poDate,
        },
        select: { id: true },
      });
      void po;
    }

    for (const l of s.statuses.logs) {
      await prisma.orderStatusLog.create({
        data: {
          orderId: order.id,
          fromStatus: l.from ?? undefined,
          toStatus: l.to,
          action: l.action,
          actorId: userByEmail.get(l.actor)!,
          actorRole: l.role,
          reason: l.reason ?? null,
          comment: l.comment ?? null,
          createdAt: l.at,
        },
      });
      await prisma.auditRecord.create({
        data: {
          actorId: userByEmail.get(l.actor),
          entityType: 'Order',
          entityId: order.id,
          action: `status.${l.action}`,
          after: { status: l.to, reason: l.reason ?? null, comment: l.comment ?? null },
          createdAt: l.at,
        },
      });
    }
  }

  console.log('Seeding order-number sequence…');
  await prisma.orderNumberSequence.create({
    data: { name: 'order_number', lastValue: 1008 },
  });

  console.log('Seed complete.');
  console.log(`   Demo password (all seeded users except the invited one): ${SEED_PASSWORD}`);
  console.log(`   Invited user awaiting password setup: ho2.pending@nimbusretail.example`);
}

function randomUnusable(): string {
  return 'seed-no-login-' + Math.random().toString(36).slice(2) + Date.now();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

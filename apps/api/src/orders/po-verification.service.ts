import { Injectable } from '@nestjs/common';

export interface VerifyQuotationItem {
  description: string;
  specification?: string | null;
  quantity: number;
  unit: string;
  unitRate: number;
}

export interface VerifyQuotation {
  quotationRef: string;
  subTotal: number | null;
  taxAmount: number | null;
  totalAmount?: number | null;
  paymentTerms: string | null;
  validityDate: Date | null;
  items: VerifyQuotationItem[];
}

export interface VerifyPoItem {
  description: string;
  quantity: number;
  unit?: string;
  unitRate: number;
}

export interface VerifyPo {
  poNumber: string;
  poDate: Date;
  poTotal: number;
  taxTotal: number | null;
  paymentTerms: string | null;
  externalRef?: string | null;
  expectedDeliveryDate: Date | null;
  items: VerifyPoItem[];
}

export interface PoCheckRow {
  key: string;
  label: string;
  expected: string | null;
  actual: string | null;
  matched: boolean | null;
  remark: string | null;
  amber?: boolean;
}

interface DecimalLike {
  toNumber?(): number;
}

const toNum = (v: number | DecimalLike | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  return typeof v.toNumber === 'function' ? v.toNumber() : Number(v);
};

const fmtMoney = (n: number | null): string | null => (n === null ? null : n.toFixed(2));

const fmtDate = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

/** TOLERANCE_PCT is applied ONLY here — never to item/qty checks. */
const TOLERANCE_PCT = 0.5;

function withinTolerance(expected: number, actual: number): { matched: boolean; amber: boolean } {
  const diff = Math.abs(expected - actual);
  const tol = (expected * TOLERANCE_PCT) / 100;
  if (diff <= tol) {
    return { matched: true, amber: diff > 0.0001 };
  }
  return { matched: false, amber: false };
}

/**
 * The canonical 8-point PO purchase-order verification checklist.
 * Pure function of (approved quotation, uploaded PO, order requirement date)
 * so it is trivially unit-testable.
 */
@Injectable()
export class PoVerificationService {
  compute(
    quotation: VerifyQuotation | null,
    po: VerifyPo,
    orderRequestedDeliveryDate: Date | null,
  ): PoCheckRow[] {
    const quoteItem = quotation?.items[0];
    const quoteTotal = quotation?.totalAmount ?? null;
    const computedTotal =
      quotation?.subTotal !== null && quotation?.subTotal !== undefined
        ? Number(quotation.subTotal) + Number(quotation.taxAmount ?? 0)
        : null;
    const expectedTotal = quoteTotal ?? computedTotal;
    const rows: PoCheckRow[] = [];

    // 1. Quotation reference & version
    const refActual = po.externalRef?.trim() || po.poNumber.trim();
    rows.push({
      key: 'quotation_ref',
      label: 'Quotation reference & version',
      expected: quotation?.quotationRef ?? null,
      actual: refActual,
      matched: quotation ? norm(refActual) === norm(quotation.quotationRef) : null,
      remark: quotation ? null : 'No approved quotation to verify against.',
    });

    // 2. Item & specification (first/primary line + item count)
    const qtyCountOk = quotation ? quotation.items.length === po.items.length : false;
    const specOk = quoteItem && po.items[0]
      ? norm(quoteItem.description) === norm(po.items[0].description)
      : false;
    rows.push({
      key: 'item_spec',
      label: 'Item & specification',
      expected: quoteItem?.description ?? null,
      actual: po.items[0]?.description ?? null,
      matched: specOk && qtyCountOk,
      remark: quotation
        ? !qtyCountOk
          ? 'Item line count differs from the approved quotation.'
          : null
        : 'No approved quotation.',
    });

    // 3. Quantity (exact)
    const quoteQty = toNum(quoteItem?.quantity);
    const poQty = toNum(po.items[0]?.quantity);
    rows.push({
      key: 'quantity',
      label: 'Quantity',
      expected: quoteQty?.toString() ?? null,
      actual: poQty?.toString() ?? null,
      matched: quoteQty !== null && poQty !== null ? quoteQty === poQty : null,
      remark: null,
    });

    // 4. Unit rate (exact)
    const quoteRate = toNum(quoteItem?.unitRate);
    const poRate = toNum(po.items[0]?.unitRate);
    rows.push({
      key: 'unit_rate',
      label: 'Unit rate',
      expected: fmtMoney(quoteRate),
      actual: fmtMoney(poRate),
      matched: quoteRate !== null && poRate !== null ? quoteRate === poRate : null,
      remark: null,
    });

    // 5. PO total (0.5% tolerance, amber when any deviation)
    if (expectedTotal !== null) {
      const exp = Number(expectedTotal);
      const t = withinTolerance(exp, po.poTotal);
      rows.push({
        key: 'total_amount',
        label: 'PO total',
        expected: fmtMoney(exp),
        actual: fmtMoney(po.poTotal),
        matched: t.matched,
        remark: t.amber ? `Within ${TOLERANCE_PCT}% tolerance.` : null,
        amber: t.amber,
      });
    } else {
      rows.push({
        key: 'total_amount',
        label: 'PO total',
        expected: null,
        actual: fmtMoney(po.poTotal),
        matched: null,
        remark: 'Quotation total unavailable.',
      });
    }

    // 6. Tax & payment terms (tax within 0.5%; terms exact)
    const quoteTax = toNum(quotation?.taxAmount);
    if (quoteTax !== null && po.taxTotal !== null) {
      const t = withinTolerance(quoteTax, po.taxTotal);
      const termsOk =
        quotation?.paymentTerms == null ||
        norm(po.paymentTerms) === norm(quotation.paymentTerms);
      rows.push({
        key: 'tax_payment',
        label: 'Tax & payment terms',
        expected: `${fmtMoney(quoteTax)} / ${quotation?.paymentTerms ?? '-'}`,
        actual: `${fmtMoney(po.taxTotal)} / ${po.paymentTerms ?? '-'}`,
        matched: t.matched && termsOk,
        remark: t.amber ? `Tax within ${TOLERANCE_PCT}% tolerance.` : termsOk ? null : 'Payment terms text differs.',
        amber: t.amber,
      });
    } else {
      rows.push({
        key: 'tax_payment',
        label: 'Tax & payment terms',
        expected: fmtMoney(quoteTax),
        actual: fmtMoney(po.taxTotal),
        matched: null,
        remark: 'Tax total missing on one side.',
      });
    }

    // 7. Delivery date against the requirement date
    if (orderRequestedDeliveryDate && po.expectedDeliveryDate) {
      const ok = po.expectedDeliveryDate.getTime() <= orderRequestedDeliveryDate.getTime();
      rows.push({
        key: 'delivery_date',
        label: 'Delivery date',
        expected: fmtDate(orderRequestedDeliveryDate),
        actual: fmtDate(po.expectedDeliveryDate),
        matched: ok,
        remark: ok ? null : 'PO delivery is later than the requested date.',
      });
    } else {
      rows.push({
        key: 'delivery_date',
        label: 'Delivery date',
        expected: fmtDate(orderRequestedDeliveryDate),
        actual: fmtDate(po.expectedDeliveryDate),
        matched: null,
        remark: 'Delivery date missing on one side.',
      });
    }

    // 8. PO date within quotation validity
    if (quotation?.validityDate) {
      const ok = po.poDate.getTime() <= quotation.validityDate.getTime();
      rows.push({
        key: 'po_vs_validity',
        label: 'PO date within quotation validity',
        expected: fmtDate(quotation.validityDate),
        actual: fmtDate(po.poDate),
        matched: ok,
        remark: ok ? null : 'PO was dated after quotation validity expired.',
      });
    } else {
      rows.push({
        key: 'po_vs_validity',
        label: 'PO date within quotation validity',
        expected: null,
        actual: fmtDate(po.poDate),
        matched: null,
        remark: 'Quotation has no validity date.',
      });
    }

    return rows;
  }
}

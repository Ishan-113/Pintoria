import { PoVerificationService } from '../../src/orders/po-verification.service';

const service = new PoVerificationService();

const quotation = {
  quotationRef: 'QTN-1031-v2',
  subTotal: 30000,
  taxAmount: 5400,
  totalAmount: 35400,
  paymentTerms: 'Net 30 days',
  validityDate: new Date('2026-12-24T00:00:00.000Z'),
  items: [
    {
      description: 'Corrugated shipping cartons',
      specification: '3-ply brown',
      quantity: 500,
      unit: 'pcs',
      unitRate: 60,
    },
  ],
};

const poBase = {
  poNumber: 'PO-7788',
  poDate: new Date('2026-11-01T00:00:00.000Z'),
  poTotal: 35400,
  taxTotal: 5400,
  paymentTerms: 'net 30 days',
  externalRef: ' QTN-1031-v2 ',
  expectedDeliveryDate: new Date('2026-12-10T00:00:00.000Z'),
  items: [
    { description: 'corrugated shipping cartons', quantity: 500, unit: 'pcs', unitRate: 60 },
  ],
};

const orderDate = new Date('2026-12-15T00:00:00.000Z');

describe('PO verification checklist', () => {
  it('emits exactly the 8 canonical checks', () => {
    const rows = service.compute(quotation, poBase, orderDate);
    expect(rows.map((r) => r.key)).toEqual([
      'quotation_ref',
      'item_spec',
      'quantity',
      'unit_rate',
      'total_amount',
      'tax_payment',
      'delivery_date',
      'po_vs_validity',
    ]);
  });

  it('a fully faithful PO matches every red check', () => {
    const rows = service.compute(quotation, poBase, orderDate);
    for (const row of rows) {
      expect({ key: row.key, matched: row.matched }).toEqual({ key: row.key, matched: true });
    }
  });

  it('applies 0.5% tolerance to the PO total — inside is amber-true, outside is false', () => {
    const inside = service.compute(quotation, { ...poBase, poTotal: 35400 + 100 }, orderDate);
    const totalRow = inside.find((r) => r.key === 'total_amount')!;
    expect(totalRow.matched).toBe(true);
    expect(totalRow.amber).toBe(true);
    expect(totalRow.remark).toContain('tolerance');

    const outside = service.compute(quotation, { ...poBase, poTotal: 40000 }, orderDate);
    expect(outside.find((r) => r.key === 'total_amount')!.matched).toBe(false);
  });

  it('applies tolerance to tax but never to quantity or unit rate', () => {
    const taxAmber = service.compute(
      quotation,
      { ...poBase, taxTotal: 5410 },
      orderDate,
    );
    expect(taxAmber.find((r) => r.key === 'tax_payment')!.matched).toBe(true);
    expect(taxAmber.find((r) => r.key === 'tax_payment')!.amber).toBe(true);

    const badQty = service.compute(
      quotation,
      { ...poBase, items: [{ ...poBase.items[0], quantity: 480 }] },
      orderDate,
    );
    expect(badQty.find((r) => r.key === 'quantity')!.matched).toBe(false);
    expect(badQty.find((r) => r.key === 'quantity')!.amber).toBeUndefined();

    const badRate = service.compute(
      quotation,
      { ...poBase, items: [{ ...poBase.items[0], unitRate: 58 }] },
      orderDate,
    );
    expect(badRate.find((r) => r.key === 'unit_rate')!.matched).toBe(false);
  });

  it('payment terms text must match the quotation', () => {
    const rows = service.compute(
      quotation,
      { ...poBase, paymentTerms: '50% advance' },
      orderDate,
    );
    expect(rows.find((r) => r.key === 'tax_payment')!.matched).toBe(false);
  });

  it('wrong quotation reference fails the first check', () => {
    const rows = service.compute(quotation, { ...poBase, externalRef: 'QTN-9999-v9' }, orderDate);
    expect(rows.find((r) => r.key === 'quotation_ref')!.matched).toBe(false);
  });

  it('delivery later than the requirement date fails; PO dated after validity fails', () => {
    const late = service.compute(
      quotation,
      { ...poBase, expectedDeliveryDate: new Date('2027-01-02T00:00:00.000Z') },
      orderDate,
    );
    expect(late.find((r) => r.key === 'delivery_date')!.matched).toBe(false);

    const expired = service.compute(
      quotation,
      { ...poBase, poDate: new Date('2027-01-05T00:00:00.000Z') },
      orderDate,
    );
    const row = expired.find((r) => r.key === 'po_vs_validity')!;
    expect(row.matched).toBe(false);
    expect(row.remark).toContain('validity');
  });

  it('without an approved quotation checks degrade to unmatched-with-reason, never crash', () => {
    const rows = service.compute(null, poBase, orderDate);
    expect(rows).toHaveLength(8);
    const refRow = rows.find((r) => r.key === 'quotation_ref')!;
    expect(refRow.matched).toBeNull();
    expect(refRow.remark).toContain('No approved quotation');
    expect(rows.find((r) => r.key === 'po_vs_validity')!.matched).toBeNull();
  });
});

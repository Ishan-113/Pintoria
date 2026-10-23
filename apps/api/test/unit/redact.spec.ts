import { stripRestricted } from '../../src/common/pricing/redact';

describe('stripRestricted (pricing redaction primitives)', () => {
  it('strips pricing keys from a flat quotation object', () => {
    const input = {
      id: 'q1',
      version: 1,
      quotationRef: 'QTN-1003-v1',
      totalAmount: 171100,
      subTotal: 145000,
      taxAmount: 26100,
      paymentTerms: 'Net 30 days',
      validityDate: '2026-11-02',
    };
    const out = stripRestricted(input) as Record<string, unknown>;
    expect(out.quotationRef).toBe('QTN-1003-v1');
    expect(out.validityDate).toBe('2026-11-02');
    expect('totalAmount' in out).toBe(false);
    expect('subTotal' in out).toBe(false);
    expect('taxAmount' in out).toBe(false);
    expect('paymentTerms' in out).toBe(false);
  });

  it('strips nested pricing keys and snake_case variants', () => {
    const input = {
      order: {
        items: [
          { description: 'Cartons', unit_rate: 24.5, quantity: 5000 },
          { description: 'Plates', unitRate: 2500, quantity: 2 },
        ],
        po_items: [{ amount: 171100 }],
      },
      note: 'hello',
    };
    const out = stripRestricted(input) as {
      order: { items: Array<Record<string, unknown>>; po_items: Array<Record<string, unknown>> };
      note: string;
    };
    expect(out.note).toBe('hello');
    expect(out.order.items[0].quantity).toBe(5000);
    expect('unit_rate' in out.order.items[0]).toBe(false);
    expect('unitRate' in out.order.items[1]).toBe(false);
    expect('amount' in out.order.po_items[0]).toBe(false);
  });

  it('handles arrays of rows and preserves order', () => {
    const rows = [{ id: 'a', rate: 1 }, { id: 'b', rate: 2 }];
    const out = stripRestricted(rows) as Array<Record<string, unknown>>;
    expect(out).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('does not mutate the original object', () => {
    const original = { totalAmount: 5, kept: true };
    stripRestricted(original);
    expect(original.totalAmount).toBe(5);
  });

  it('leaves scalars and dates untouched', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(stripRestricted(42)).toBe(42);
    expect(stripRestricted('x')).toBe('x');
    expect(stripRestricted(null)).toBe(null);
    expect(stripRestricted(d)).toBe(d);
  });
});

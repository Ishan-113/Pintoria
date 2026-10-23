import { ruleFor, TRANSITIONS } from '../../src/orders/order-transitions.service';
import type { OrderAction, OrderStatus } from '@pintoria/shared';

describe('order transitions registry', () => {
  it('maps the requirement round correctly', () => {
    expect(ruleFor('SUBMITTED', 'approve_requirement')?.to).toBe('QUOTATION_IN_PROGRESS');
    expect(ruleFor('SUBMITTED', 'approve_requirement')?.permission).toBe('requirement.decide');
    expect(ruleFor('SUBMITTED', 'return_for_clarification')?.to).toBe('RETURNED_FOR_CLARIFICATION');
    expect(ruleFor('SUBMITTED', 'return_for_clarification')?.reasonRequired).toBe(true);
    expect(ruleFor('SUBMITTED', 'reject_requirement')?.reasonRequired).toBe(true);
    expect(ruleFor('RETURNED_FOR_CLARIFICATION', 'submit_requirement')?.to).toBe('SUBMITTED');
  });

  it('requirement decisions are never possible once quoting has started', () => {
    for (const status of ['QUOTATION_IN_PROGRESS', 'QUOTATION_SUBMITTED', 'AWAITING_PO'] as OrderStatus[]) {
      expect(ruleFor(status, 'approve_requirement')).toBeUndefined();
      expect(ruleFor(status, 'reject_requirement')).toBeUndefined();
    }
  });

  it('quotation submit is live only while quoting or revising, sales-scoped', () => {
    expect(ruleFor('QUOTATION_IN_PROGRESS', 'submit_quotation')).toBeDefined();
    expect(ruleFor('REVISION_REQUESTED', 'submit_quotation')).toBeDefined();
    expect(ruleFor('SUBMITTED', 'submit_quotation')).toBeUndefined();
    expect(ruleFor('PO_RECEIVED', 'submit_quotation')).toBeUndefined();
    expect(ruleFor('QUOTATION_IN_PROGRESS', 'submit_quotation')?.permission).toBe('quotation.manage');
  });

  it('quotation decision actions require a reason and flow back into the pipeline', () => {
    expect(ruleFor('QUOTATION_SUBMITTED', 'approve_quotation')?.to).toBe('AWAITING_PO');
    expect(ruleFor('QUOTATION_SUBMITTED', 'request_revision')?.to).toBe('REVISION_REQUESTED');
    expect(ruleFor('QUOTATION_SUBMITTED', 'request_revision')?.reasonRequired).toBe(true);
    expect(ruleFor('QUOTATION_SUBMITTED', 'reject_quotation')?.to).toBe('REJECTED');
    expect(ruleFor('QUOTATION_SUBMITTED', 'reject_quotation')?.reasonRequired).toBe(true);
  });

  it('PO loop: upload, query, confirm', () => {
    expect(ruleFor('AWAITING_PO', 'upload_po')?.to).toBe('PO_RECEIVED');
    expect(ruleFor('AWAITING_PO', 'upload_po')?.permission).toBe('po.upload');
    expect(ruleFor('PO_RECEIVED', 'raise_po_query')?.to).toBe('AWAITING_PO');
    expect(ruleFor('PO_RECEIVED', 'raise_po_query')?.reasonRequired).toBe(true);
    expect(ruleFor('PO_RECEIVED', 'confirm_order')?.to).toBe('ORDER_CONFIRMED');
    expect(ruleFor('PO_RECEIVED', 'confirm_order')?.permission).toBe('order.confirm');
  });

  it('fulfilment chain is a strict milestone ladder', () => {
    expect(ruleFor('ORDER_CONFIRMED', 'start_production')?.to).toBe('IN_PRODUCTION');
    expect(ruleFor('IN_PRODUCTION', 'start_qc')?.to).toBe('QUALITY_CHECK');
    expect(ruleFor('QUALITY_CHECK', 'dispatch')?.to).toBe('DISPATCHED');
    expect(ruleFor('DISPATCHED', 'mark_delivered')?.to).toBe('DELIVERED_CLOSED');
    expect(ruleFor('IN_PRODUCTION', 'start_production')).toBeUndefined();
    expect(ruleFor('DISPATCHED', 'start_qc')).toBeUndefined();
  });

  it('cancellation is registered at every non-terminal stage but no terminal one', () => {
    const nonTerminal = (
      [
        'SUBMITTED',
        'RETURNED_FOR_CLARIFICATION',
        'QUOTATION_IN_PROGRESS',
        'QUOTATION_SUBMITTED',
        'REVISION_REQUESTED',
        'AWAITING_PO',
        'PO_RECEIVED',
        'ORDER_CONFIRMED',
        'IN_PRODUCTION',
        'QUALITY_CHECK',
        'DISPATCHED',
      ] as OrderStatus[]
    );
    for (const status of nonTerminal) {
      expect(ruleFor(status, 'cancel_order')?.to).toBe('CANCELLED');
      expect(ruleFor(status, 'cancel_order')?.reasonRequired).toBe(true);
    }
    for (const status of ['REJECTED', 'CANCELLED', 'DELIVERED_CLOSED'] as OrderStatus[]) {
      expect(ruleFor(status, 'cancel_order')).toBeUndefined();
      expect(TRANSITIONS[status]).toEqual({});
    }
  });

  it('no action can be fired out of order for the whole matrix', () => {
    const expected: Partial<Record<OrderStatus, OrderAction[]>> = {
      SUBMITTED: ['submit_requirement', 'approve_requirement', 'return_for_clarification', 'reject_requirement', 'cancel_order'],
      RETURNED_FOR_CLARIFICATION: ['submit_requirement', 'cancel_order'],
      QUOTATION_IN_PROGRESS: ['submit_quotation', 'cancel_order'],
      QUOTATION_SUBMITTED: ['approve_quotation', 'request_revision', 'reject_quotation', 'cancel_order'],
      REVISION_REQUESTED: ['submit_quotation', 'cancel_order'],
      AWAITING_PO: ['upload_po', 'cancel_order'],
      PO_RECEIVED: ['raise_po_query', 'confirm_order', 'cancel_order'],
      ORDER_CONFIRMED: ['start_production', 'cancel_order'],
      IN_PRODUCTION: ['start_qc', 'cancel_order'],
      QUALITY_CHECK: ['dispatch', 'cancel_order'],
      DISPATCHED: ['mark_delivered', 'cancel_order'],
      REJECTED: [],
      CANCELLED: [],
      DELIVERED_CLOSED: [],
    };
    for (const [status, actions] of Object.entries(expected) as [OrderStatus, OrderAction[]][]) {
      expect(Object.keys(TRANSITIONS[status]).sort()).toEqual([...actions].sort());
    }
  });
});

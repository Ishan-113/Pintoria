import {
  CRITICAL_TEMPLATES,
  renderNotification,
  templateForAction,
} from '../../src/notifications/notification-templates';
import {
  isStageOverdue,
  statusesForRole,
  thresholdFor,
} from '../../src/dashboard/dashboard.service';

describe('notification templates', () => {
  it('renders a subject + body from the order context for every template', () => {
    const ctx = {
      orderNumber: 'PRT-1042',
      title: 'Festive cartons',
      actorName: 'Asha Vaidya',
      reason: 'Kraft weight missing',
      toStatus: 'DISPATCHED' as const,
    };
    const keys = [
      'requirement.returned',
      'requirement.approved',
      'requirement.rejected',
      'quotation.submitted',
      'quotation.approved',
      'quotation.revision_requested',
      'quotation.rejected',
      'po.query_raised',
      'order.confirmed',
      'order.milestone',
      'order.cancelled',
    ] as const;
    for (const key of keys) {
      const rendered = renderNotification(key, ctx);
      expect(rendered.subject).toContain('PRT-1042');
      expect(rendered.text.length).toBeGreaterThan(20);
      expect(rendered.html).toContain('<p>');
    }
  });

  it('escapes HTML in reasons so mail previews cannot inject markup', () => {
    const rendered = renderNotification('requirement.returned', {
      orderNumber: 'PRT-1042',
      title: 'X',
      reason: '<script>alert(1)</script>',
    });
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.html).not.toContain('<script>');
  });

  it('maps workflow actions onto the curated template set (default = milestone)', () => {
    expect(templateForAction('approve_requirement')).toBe('requirement.approved');
    expect(templateForAction('return_for_clarification')).toBe('requirement.returned');
    expect(templateForAction('submit_quotation')).toBe('quotation.submitted');
    expect(templateForAction('reject_quotation')).toBe('quotation.rejected');
    expect(templateForAction('raise_po_query')).toBe('po.query_raised');
    expect(templateForAction('confirm_order')).toBe('order.confirmed');
    expect(templateForAction('cancel_order')).toBe('order.cancelled');
    expect(templateForAction('start_production')).toBe('order.milestone');
    expect(templateForAction('mark_delivered')).toBe('order.milestone');
  });

  it('flags the right templates as critical', () => {
    for (const t of [
      'requirement.returned',
      'requirement.rejected',
      'quotation.revision_requested',
      'quotation.rejected',
      'po.query_raised',
      'order.cancelled',
    ] as const) {
      expect(CRITICAL_TEMPLATES.has(t)).toBe(true);
    }
    expect(CRITICAL_TEMPLATES.has('order.milestone')).toBe(false);
    expect(CRITICAL_TEMPLATES.has('requirement.approved')).toBe(false);
  });
});

describe('dashboard delay + queue maths', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');

  it('flags a stage only once the threshold is exceeded', () => {
    const entered = new Date('2026-01-01T09:00:00.000Z'); // 3h in stage
    const overdue = isStageOverdue(entered, now, 2);
    expect(overdue).toEqual({ overlyByHours: 1, thresholdHours: 2 });
    expect(isStageOverdue(entered, now, 3)).toBeNull();
    expect(isStageOverdue(entered, now, 0)).toBeNull();
  });

  it('per-stage thresholds override the default', () => {
    const t = { default: 48, perStage: { ORDER_CONFIRMED: 72, PO_RECEIVED: 24 } };
    expect(thresholdFor('ORDER_CONFIRMED', t)).toBe(72);
    expect(thresholdFor('PO_RECEIVED', t)).toBe(24);
    expect(thresholdFor('IN_PRODUCTION', t)).toBe(48);
  });

  it('queues per role', () => {
    expect(statusesForRole('PRINTORIA_SALES')).toEqual([
      'QUOTATION_IN_PROGRESS',
      'QUOTATION_SUBMITTED',
      'REVISION_REQUESTED',
    ]);
    expect(statusesForRole('PRINTORIA_OPS')).toEqual([
      'PO_RECEIVED',
      'ORDER_CONFIRMED',
      'IN_PRODUCTION',
      'QUALITY_CHECK',
    ]);
    expect(statusesForRole('PRINTORIA_ADMIN')).toBeNull();
    expect(statusesForRole('CLIENT_HEAD_OFFICE')).toBeNull();
  });
});

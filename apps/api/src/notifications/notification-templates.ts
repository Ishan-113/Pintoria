import type { OrderAction, OrderStatus } from '@pintoria/shared';

export type TemplateKey =
  | 'requirement.returned'
  | 'requirement.approved'
  | 'requirement.rejected'
  | 'quotation.submitted'
  | 'quotation.approved'
  | 'quotation.revision_requested'
  | 'quotation.rejected'
  | 'po.query_raised'
  | 'order.confirmed'
  | 'order.milestone'
  | 'order.cancelled';

/** Templates where an alert must reach the recipient even if the client muted alerts. */
export const CRITICAL_TEMPLATES = new Set<TemplateKey>([
  'requirement.returned',
  'requirement.rejected',
  'quotation.revision_requested',
  'quotation.rejected',
  'po.query_raised',
  'order.cancelled',
]);

export interface NotificationContext {
  orderNumber: string;
  title: string;
  actorName?: string;
  reason?: string;
  comment?: string;
  toStatus?: OrderStatus;
}

export interface RenderedNotification {
  subject: string;
  text: string;
  html: string;
}

function line(body: string): string {
  return body
    ? `${body}`
    : '';
}

/** The only place email copy lives, keyed by template. */
export function renderNotification(
  templateKey: TemplateKey,
  ctx: NotificationContext,
): RenderedNotification {
  const who = ctx.actorName ? ` by ${ctx.actorName}` : '';
  const why = ctx.reason ? ` Reason: “${ctx.reason}”.` : '';
  const head = `Order ${ctx.orderNumber} — ${ctx.title}`;
  const tail = '— Printoria Portal';

  const map: Record<TemplateKey, { subject: string; body: string }> = {
    'requirement.returned': {
      subject: `${head}: requirement returned for clarification`,
      body: `Your requirement was returned for clarification${who}.${why} Please review, update the requirement and resubmit.`,
    },
    'requirement.approved': {
      subject: `${head}: requirement approved`,
      body: `The requirement was approved${who}. Printoria sales will now prepare a quotation.`,
    },
    'requirement.rejected': {
      subject: `${head}: requirement rejected`,
      body: `The requirement was rejected${who}.${why} No quotation will be prepared unless the order is reopened.`,
    },
    'quotation.submitted': {
      subject: `${head}: quotation ready for your decision`,
      body: `A quotation was submitted${who}. Head Office can now review and approve, request revisions or reject it.`,
    },
    'quotation.approved': {
      subject: `${head}: quotation approved`,
      body: `The quotation was approved by Head Office${who}. Waiting for the client PO upload.`,
    },
    'quotation.revision_requested': {
      subject: `${head}: quotation revision requested`,
      body: `Head Office requested a quotation revision${who}.${why} Please revise the draft and resubmit.`,
    },
    'quotation.rejected': {
      subject: `${head}: quotation rejected`,
      body: `The quotation was rejected by Head Office${who}.${why}`,
    },
    'po.query_raised': {
      subject: `${head}: query raised on the purchase order`,
      body: `Operations raised a query on the uploaded PO${who}.${why} The order is back to AWAITING_PO.`,
    },
    'order.confirmed': {
      subject: `${head}: order confirmed`,
      body: `The purchase order passed verification and the order was confirmed${who}. Production is about to start.`,
    },
    'order.milestone': {
      subject: `${head}: status update to ${ctx.toStatus ?? 'the next stage'}`,
      body: `The order moved to ${ctx.toStatus ?? 'a new stage'}${who}.${line(ctx.comment ? ` Note: ${ctx.comment}.` : '')}`,
    },
    'order.cancelled': {
      subject: `${head}: order cancelled`,
      body: `The order was cancelled${who}.${why}`,
    },
  };

  const { subject, body } = map[templateKey];
  return {
    subject,
    text: `${body}\n\n${tail}\n`,
    html: `<p><strong>${escapeHtml(subject)}</strong></p><p>${escapeHtml(body)}</p><p>— Printoria Portal</p>`,
  };
}

export function templateForAction(action: OrderAction): TemplateKey {
  const map: Partial<Record<OrderAction, TemplateKey>> = {
    approve_requirement: 'requirement.approved',
    return_for_clarification: 'requirement.returned',
    reject_requirement: 'requirement.rejected',
    submit_quotation: 'quotation.submitted',
    approve_quotation: 'quotation.approved',
    request_revision: 'quotation.revision_requested',
    reject_quotation: 'quotation.rejected',
    raise_po_query: 'po.query_raised',
    confirm_order: 'order.confirmed',
    cancel_order: 'order.cancelled',
  };
  return map[action] ?? 'order.milestone';
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

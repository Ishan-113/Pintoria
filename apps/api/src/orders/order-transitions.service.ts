import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ORDER_STATUSES } from '@pintoria/shared';
import type { OrderAction, OrderStatus, Permission } from '@pintoria/shared';
import type { Prisma } from '@prisma/client';
import { hasPermission } from '@pintoria/shared';
import type { SessionUser } from '../auth/auth.types';
import { AuditService, type AuditEntry } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface TransitionRule {
  to: OrderStatus;
  permission: Permission;
  reasonRequired?: boolean;
}

/**
 * (status, action) → result registry. Validation order in `execute`:
 * unknown transition → 409; no permission → 403; missing reason → 422.
 */
export const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderAction, TransitionRule>>> = {
  SUBMITTED: {
    submit_requirement: { to: 'SUBMITTED', permission: 'requirement.update' },
    approve_requirement: { to: 'QUOTATION_IN_PROGRESS', permission: 'requirement.decide' },
    return_for_clarification: {
      to: 'RETURNED_FOR_CLARIFICATION',
      permission: 'requirement.decide',
      reasonRequired: true,
    },
    reject_requirement: { to: 'REJECTED', permission: 'requirement.decide', reasonRequired: true },
  },
  RETURNED_FOR_CLARIFICATION: {
    submit_requirement: { to: 'SUBMITTED', permission: 'requirement.update' },
  },
  QUOTATION_IN_PROGRESS: {
    submit_quotation: { to: 'QUOTATION_SUBMITTED', permission: 'quotation.manage' },
  },
  QUOTATION_SUBMITTED: {
    approve_quotation: { to: 'AWAITING_PO', permission: 'quotation.decide' },
    request_revision: { to: 'REVISION_REQUESTED', permission: 'quotation.decide', reasonRequired: true },
    reject_quotation: { to: 'REJECTED', permission: 'quotation.decide', reasonRequired: true },
  },
  REVISION_REQUESTED: {
    submit_quotation: { to: 'QUOTATION_SUBMITTED', permission: 'quotation.manage' },
  },
  AWAITING_PO: {
    upload_po: { to: 'PO_RECEIVED', permission: 'po.upload' },
  },
  PO_RECEIVED: {
    raise_po_query: { to: 'AWAITING_PO', permission: 'po.verify', reasonRequired: true },
    confirm_order: { to: 'ORDER_CONFIRMED', permission: 'order.confirm' },
  },
  ORDER_CONFIRMED: {
    start_production: { to: 'IN_PRODUCTION', permission: 'fulfilment.advance' },
  },
  IN_PRODUCTION: {
    start_qc: { to: 'QUALITY_CHECK', permission: 'fulfilment.advance' },
  },
  QUALITY_CHECK: {
    dispatch: { to: 'DISPATCHED', permission: 'fulfilment.advance' },
  },
  DISPATCHED: {
    mark_delivered: { to: 'DELIVERED_CLOSED', permission: 'fulfilment.advance' },
  },
  REJECTED: {},
  CANCELLED: {},
  DELIVERED_CLOSED: {},
};

const TERMINAL_STATUSES: OrderStatus[] = ['REJECTED', 'CANCELLED', 'DELIVERED_CLOSED'];

const CANCELLED_TO = 'CANCELLED' as const;

/** Cancellation follows cancellation_rules settings; the rule here only carries permission/reason. */
function cancelRule(): TransitionRule {
  return { to: CANCELLED_TO, permission: 'order.cancel', reasonRequired: true };
}

/** Cancellations stay legal from every non-terminal stage (subject to role + settings). */
function withCancel(
  rules: Partial<Record<OrderAction, TransitionRule>>,
): Partial<Record<OrderAction, TransitionRule>> {
  return { ...rules, cancel_order: cancelRule() };
}

for (const status of Object.keys(TRANSITIONS) as OrderStatus[]) {
  if (!TERMINAL_STATUSES.includes(status)) {
    TRANSITIONS[status] = withCancel(TRANSITIONS[status]);
  }
}

export function ruleFor(status: OrderStatus, action: OrderAction): TransitionRule | undefined {
  return TRANSITIONS[status]?.[action];
}

export interface TransitionOptions {
  reason?: string;
  comment?: string;
  payload?: Record<string, unknown>;
}

const CLIENT_CANCEL_UNTIL_DEFAULT = 'PO_RECEIVED';
const OPS_CANCEL_UNTIL_DEFAULT = 'QUALITY_CHECK';

/**
 * Executes a transition inside the caller's Prisma transaction: order update,
 * status log and audit record are written together or not at all.
 */
@Injectable()
export class OrderTransitionsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async execute(
    tx: Prisma.TransactionClient,
    order: { id: string; status: OrderStatus },
    user: SessionUser,
    action: OrderAction,
    opts: TransitionOptions = {},
  ): Promise<OrderStatus> {
    const rule = ruleFor(order.status, action);
    if (!rule) {
      const allowed = await this.allowedActions(user, order.status);
      throw new ConflictException({
        message: `Action "${action}" is not allowed while the order is ${order.status}.`,
        allowedActions: allowed,
      });
    }

    let cancellationChargesApply: boolean | undefined;
    if (action === 'cancel_order') {
      cancellationChargesApply = await this.assertCancelAllowed(order.status, user);
    } else if (!hasPermission(user.permissions, rule.permission)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    if (rule.reasonRequired && !opts.reason?.trim()) {
      throw new UnprocessableEntityException(`A reason is required for "${action}".`);
    }

    const now = new Date();
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: rule.to,
        statusEnteredAt: now,
        ...(action === 'cancel_order'
          ? {
              cancellation: {
                byRole: user.role,
                actorId: user.id,
                reason: opts.reason,
                chargesApply: cancellationChargesApply ?? false,
                at: now.toISOString(),
              },
            }
          : {}),
        ...(rule.to === 'DELIVERED_CLOSED' ? { closedAt: now } : {}),
      },
    });

    await tx.orderStatusLog.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: rule.to,
        action,
        actorId: user.id,
        actorRole: user.role,
        reason: opts.reason ?? null,
        comment: opts.comment ?? null,
        metadata: opts.payload ? (opts.payload as Prisma.InputJsonValue) : undefined,
      },
    });

    const entry: AuditEntry = {
      actorId: user.id,
      entityType: 'Order',
      entityId: order.id,
      action: `status.${action}`,
      after: {
        from: order.status,
        to: rule.to,
        ...(opts.reason ? { reason: opts.reason } : {}),
        ...(opts.comment ? { comment: opts.comment } : {}),
        ...(opts.payload ?? {}),
        ...(action === 'cancel_order'
          ? { chargesApply: cancellationChargesApply ?? false }
          : {}),
      },
    };
    await this.audit.record(entry, tx);

    // Notification fan-out shares the transaction for its DB rows; mail send is
    // best-effort inside the service and never rolls the workflow back.
    try {
      await this.notifications.onTransition(
        tx,
        order.id,
        user,
        action,
        { reason: opts.reason, comment: opts.comment, toStatus: rule.to },
      );
    } catch {
      // notifications must never break the workflow
    }

    return rule.to;
  }

  /** Status-specific cancel gate driven by cancellation_rules settings. */
  private async assertCancelAllowed(status: OrderStatus, user: SessionUser): Promise<boolean> {
    const rules = await this.settings.cancellationRules();
    if (user.role === 'CLIENT_REGIONAL') {
      const allowed =
        rules.regionalMayCancel &&
        (status === 'SUBMITTED' || status === 'RETURNED_FOR_CLARIFICATION');
      if (!allowed) {
        throw new ConflictException({
          message: 'Regional offices cannot cancel an order at this stage.',
          allowedActions: [],
        });
      }
      return false;
    }

    if (!hasPermission(user.permissions, 'order.cancel')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const idx = (s: OrderStatus) => ORDER_STATUSES.indexOf(s);
    const until =
      user.role === 'PRINTORIA_ADMIN'
        ? 'DISPATCHED'
        : user.role.startsWith('PRINTORIA_')
          ? (rules.printoriaOpsUntil ?? OPS_CANCEL_UNTIL_DEFAULT)
          : (rules.clientHoUntil ?? CLIENT_CANCEL_UNTIL_DEFAULT);

    if (idx(status) > idx(until as OrderStatus)) {
      throw new ConflictException({
        message: `Cancellation is no longer allowed at stage ${status} for your role.`,
        allowedActions: [],
      });
    }

    return rules.chargesAfterPo && idx(status) >= idx('PO_RECEIVED');
  }

  /** Used in 409 payloads so the UI can render the buttons that ARE valid. */
  async allowedActions(user: SessionUser, status: OrderStatus): Promise<OrderAction[]> {
    const registered = Object.entries(TRANSITIONS[status] ?? {}) as [OrderAction, TransitionRule][];
    const rules = await this.settings.cancellationRules();
    const result: OrderAction[] = [];
    for (const [action, rule] of registered) {
      if (action === 'cancel_order') {
        if (user.role === 'CLIENT_REGIONAL') {
          if (rules.regionalMayCancel && (status === 'SUBMITTED' || status === 'RETURNED_FOR_CLARIFICATION')) {
            result.push(action);
          }
        } else if (hasPermission(user.permissions, rule.permission)) {
          result.push(action);
        }
        continue;
      }
      if (hasPermission(user.permissions, rule.permission)) result.push(action);
    }
    return result;
  }
}

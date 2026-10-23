import { Injectable, Logger } from '@nestjs/common';
import { ORDER_STATUS_LABELS } from '@pintoria/shared';
import type { OrderStatus } from '@pintoria/shared';
import { isStageOverdue, thresholdFor } from '../dashboard/dashboard.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

interface ThresholdSettings {
  default: number;
  perStage: Record<string, number>;
}

const OPEN_STATUSES: OrderStatus[] = [
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
];

/** Who is supposed to move an order forward when it sits in a stage. */
const STAGE_OWNER: Partial<Record<OrderStatus, 'ho' | 'sales' | 'ops'>> = {
  SUBMITTED: 'ho',
  RETURNED_FOR_CLARIFICATION: 'ho',
  QUOTATION_IN_PROGRESS: 'sales',
  QUOTATION_SUBMITTED: 'ho',
  REVISION_REQUESTED: 'sales',
  AWAITING_PO: 'ho',
  PO_RECEIVED: 'ops',
  ORDER_CONFIRMED: 'ops',
  IN_PRODUCTION: 'ops',
  QUALITY_CHECK: 'ops',
  DISPATCHED: 'ops',
};

const DEDUPE_WINDOW_MS = 20 * 3600 * 1000; // same order+recipient nudged at most ~daily

interface Recipient {
  id: string;
  email: string;
  fullName: string;
}

/**
 * Scheduled nudges (pg-boss worker) + the manual "run now" used by admins.
 *
 * - stage-overdue: an order sitting past its stage SLA emails each responsible
 *   audience member once (deduped to ~daily by a look-back on NotificationLog).
 * - pending-digest: each client HO (honouring client alert prefs) plus sales
 *   and ops staff get a single email listing the orders waiting on them.
 *   Admins are never digested (they audit rather than act).
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger('reminders');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  async overdueOnce(): Promise<number> {
    const thresholds = await this.settings.get<ThresholdSettings>('delay_threshold_hours');
    const now = new Date();

    const open = await this.prisma.order.findMany({
      where: { deletedAt: null, status: { in: OPEN_STATUSES } },
      select: {
        id: true,
        orderNumber: true,
        title: true,
        status: true,
        clientId: true,
        statusEnteredAt: true,
      },
    });

    const overdue = open.flatMap<OverdueOrder>((o) => {
      const delay = isStageOverdue(o.statusEnteredAt, now, thresholdFor(o.status, thresholds));
      if (!delay) return [];
      if (!STAGE_OWNER[o.status]) return []; // stages nobody can action right now
      return [
        {
          id: o.id,
          orderNumber: o.orderNumber,
          title: o.title,
          status: o.status,
          clientId: o.clientId,
          overlyByHours: delay.overlyByHours,
        },
      ];
    });
    if (overdue.length === 0) return 0;

    const owners = await this.resolveOwners(overdue);
    const recentlyNudged = await this.recentReminders(
      overdue.flatMap((o) => (owners.get(o.id) ?? []).map((u) => u.id)),
    );

    let sent = 0;
    for (const order of overdue) {
      for (const user of owners.get(order.id) ?? []) {
        if (recentlyNudged.has(`${order.id}:${user.id}`)) continue;
        const ok = await this.sendAndLog(
          order.id,
          user,
          `Reminder: ${order.orderNumber} waiting in ${ORDER_STATUS_LABELS[order.status]}`,
          `${order.orderNumber} — "${order.title}" has been in ` +
            `${ORDER_STATUS_LABELS[order.status]} for ${order.overlyByHours}h past its limit. ` +
            `Open the Printoria Portal to act on it.`,
          'stage_overdue_reminder',
        );
        if (ok) sent += 1;
      }
    }
    this.logger.log(`stage-overdue run: ${overdue.length} orders past SLA, ${sent} reminders sent`);
    return sent;
  }

  async digestOnce(): Promise<number> {
    const now = new Date();
    const open = await this.prisma.order.findMany({
      where: { deletedAt: null, status: { in: OPEN_STATUSES } },
      select: {
        id: true,
        orderNumber: true,
        title: true,
        status: true,
        clientId: true,
        createdAt: true,
      },
    });

    const hoUsers = await this.prisma.user.findMany({
      where: { role: 'CLIENT_HEAD_OFFICE', status: 'ACTIVE' },
      select: { id: true, email: true, fullName: true, clientId: true },
    });
    const prefs = await this.prisma.clientNotificationPrefs.findMany({
      where: { clientId: { in: hoUsers.map((h) => h.clientId).filter((x): x is string => !!x) } },
      select: { clientId: true, emailAlerts: true, dailyPendingReminder: true },
    });
    const prefByClient = new Map(prefs.map((p) => [p.clientId, p]));

    const staff = await this.prisma.user.findMany({
      where: { role: { in: ['PRINTORIA_SALES', 'PRINTORIA_OPS'] }, status: 'ACTIVE' },
      select: { id: true, email: true, fullName: true, role: true },
    });

    const queueFor = (clientIds: string[], statuses: OrderStatus[]) =>
      open
        .filter(
          (o) =>
            clientIds.includes(o.clientId) &&
            statuses.includes(o.status) &&
            // two weeks of silence is enough for a stage nobody watches
            now.getTime() - o.createdAt.getTime() < 90 * 86400 * 1000,
        )
        .map((o) => ({
          orderNumber: o.orderNumber,
          title: o.title,
          stage: ORDER_STATUS_LABELS[o.status],
          days: Math.floor((now.getTime() - o.createdAt.getTime()) / 86400000),
        }));

    const salesClientIds = [...new Set(
      open.filter((o) => ['QUOTATION_IN_PROGRESS', 'REVISION_REQUESTED'].includes(o.status)).map((o) => o.clientId),
    )];
    const opsClientIds = [...new Set(open.filter((o) => o.status === 'PO_RECEIVED').map((o) => o.clientId))];

    let sent = 0;

    // client HO digests (prefs-aware)
    for (const ho of hoUsers) {
      if (!ho.clientId) continue;
      const pref = prefByClient.get(ho.clientId);
      if (pref?.emailAlerts === false) continue;
      if (pref?.dailyPendingReminder === false) continue;
      const items = queueFor([ho.clientId], [
        'SUBMITTED',
        'QUOTATION_SUBMITTED',
        'AWAITING_PO',
        'RETURNED_FOR_CLARIFICATION',
      ]);
      if (items.length === 0) continue;
      const ok = await this.sendAndLog(
        null,
        ho,
        `Daily digest: ${items.length} order(s) waiting on your team`,
        this.digestBody(items),
        'daily_digest',
      );
      if (ok) sent += 1;
    }

    // staff digests (no client prefs; send to everyone ACTIVE in the role)
    for (const user of staff) {
      const items =
        user.role === 'PRINTORIA_SALES'
          ? queueFor(salesClientIds, ['QUOTATION_IN_PROGRESS', 'REVISION_REQUESTED'])
          : queueFor(opsClientIds, ['PO_RECEIVED']);
      if (items.length === 0) continue;
      const ok = await this.sendAndLog(
        null,
        user,
        `Daily digest: ${items.length} order(s) waiting on ${user.role === 'PRINTORIA_SALES' ? 'the sales team' : 'ops'}`,
        this.digestBody(items),
        'daily_digest',
      );
      if (ok) sent += 1;
    }
    return sent;
  }

  private digestBody(items: { orderNumber: string; title: string; stage: string; days: number }[]): string {
    return [
      'Work waiting on you in the Printoria Portal:',
      '',
      ...items.map((i) => `- ${i.orderNumber} "${i.title}" — ${i.stage} (${i.days}d waiting)`),
      '',
      'Log in to the portal to act on them.',
    ].join('\n');
  }

  private async resolveOwners(
    orders: OverdueOrder[],
  ): Promise<Map<string, Recipient[]>> {
    const map = new Map<string, Recipient[]>();
    const clientIds = [...new Set(orders.map((o) => o.clientId))];

    const [hoUsers, sales, ops] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'CLIENT_HEAD_OFFICE', status: 'ACTIVE', clientId: { in: clientIds } },
        select: { id: true, email: true, fullName: true, clientId: true },
      }),
      this.prisma.user.findMany({
        where: { role: 'PRINTORIA_SALES', status: 'ACTIVE' },
        select: { id: true, email: true, fullName: true },
      }),
      this.prisma.user.findMany({
        where: { role: 'PRINTORIA_OPS', status: 'ACTIVE' },
        select: { id: true, email: true, fullName: true },
      }),
    ]);

    for (const order of orders) {
      const owner = STAGE_OWNER[order.status];
      const recipients: Recipient[] =
        owner === 'ho'
          ? hoUsers.filter((u) => u.clientId === order.clientId)
          : owner === 'sales'
            ? sales
            : ops;
      if (recipients.length > 0) map.set(order.id, recipients);
    }
    return map;
  }

  private async recentReminders(recipientIds: string[]): Promise<Set<string>> {
    if (recipientIds.length === 0) return new Set();
    const rows = await this.prisma.notificationLog.findMany({
      where: {
        templateKey: 'stage_overdue_reminder',
        recipientId: { in: recipientIds },
        queuedAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
      },
      select: { orderId: true, recipientId: true },
    });
    return new Set(rows.map((r) => `${r.orderId}:${r.recipientId}`));
  }

  /** Sends one email, then writes the NotificationLog row (SENT or FAILED). */
  private async sendAndLog(
    orderId: string | null,
    user: Recipient,
    subject: string,
    text: string,
    templateKey: string,
  ): Promise<boolean> {
    const base = {
      ...(orderId ? { orderId } : {}),
      recipientId: user.id,
      channel: 'email',
      templateKey,
      toAddress: user.email,
      payload: { subject },
    };
    try {
      await this.mail.send({ to: user.email, subject, text, html: `<pre>${text}</pre>` });
      await this.prisma.notificationLog.create({
        data: { ...base, status: 'SENT', attempts: 1, sentAt: new Date() },
      });
      return true;
    } catch (err) {
      this.logger.warn(`failed to send ${templateKey} to ${user.email}: ${String(err).slice(0, 200)}`);
      await this.prisma.notificationLog
        .create({
          data: { ...base, status: 'FAILED', attempts: 0, lastError: String(err).slice(0, 300) },
        })
        .catch(() => undefined);
      return false;
    }
  }
}

interface OverdueOrder {
  id: string;
  orderNumber: string;
  title: string;
  status: OrderStatus;
  clientId: string;
  overlyByHours: number;
}

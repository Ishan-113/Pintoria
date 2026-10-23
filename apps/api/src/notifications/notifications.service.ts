import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { OrderAction, OrderStatus } from '@pintoria/shared';
import type { Prisma } from '@prisma/client';
import { hasPermission } from '@pintoria/shared';
import { stripRestricted } from '../common/pricing/redact';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import type { SessionUser } from '../auth/auth.types';
import {
  CRITICAL_TEMPLATES,
  renderNotification,
  templateForAction,
  type NotificationContext,
  type TemplateKey,
} from './notification-templates';

interface ResolvedRecipient {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: string;
  pricingView: boolean;
  clientId: string | null;
}

export interface EnqueueInput {
  orderId: string;
  templateKey: TemplateKey;
  ctx: NotificationContext;
  recipients: ResolvedRecipient[];
  actorId?: string;
  payload?: Record<string, unknown>;
}

/**
 * Notification fan-out for workflow events.
 * DB rows (NotificationLog) are written in the caller's transaction so they are
 * never lost; the actual email send happens best-effort and updates the row.
 * Client alert preferences are honoured except for CRITICAL templates when
 * `criticalAlwaysSend` is on.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('notifications');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  /**
   * Called by the transitions engine after a successful state change.
   * Resolves who should hear about it, then enqueues per-recipient rows.
   */
  async onTransition(
    tx: Prisma.TransactionClient,
    orderId: string,
    actor: { id: string; fullName: string },
    action: OrderAction,
    opts: { reason?: string; comment?: string; toStatus?: string } = {},
  ): Promise<void> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, clientId: true, title: true },
    });
    if (!order) return;

    const recipients = await this.resolveRecipients(tx, order.id, action, actor.id);
    if (recipients.length === 0) return;

    const templateKey = templateForAction(action);
    const ctx: NotificationContext = {
      orderNumber: order.orderNumber,
      title: order.title,
      actorName: actor.fullName,
      reason: opts.reason,
      comment: opts.comment,
      toStatus: opts.toStatus as OrderStatus | undefined,
    };

    await this.enqueue(tx, {
      orderId: order.id,
      templateKey,
      ctx,
      recipients,
      actorId: actor.id,
      payload: {
        orderNumber: order.orderNumber,
        action,
        ...(opts.reason ? { reason: opts.reason } : {}),
      },
    });
  }

  /** Who hears about what — the workflow's address book. */
  private async resolveRecipients(
    tx: Prisma.TransactionClient,
    orderId: string,
    action: OrderAction,
    actorId: string,
  ): Promise<ResolvedRecipient[]> {
    const order = await tx.order.findFirst({
      where: { id: orderId },
      include: {
        createdBy: true,
        client: { include: { users: { where: { deletedAt: null, status: 'ACTIVE' } } } },
      },
    });
    if (!order) return [];

    const participants: ResolvedRecipient[] = [];
    const push = (u: {
      id: string;
      email: string;
      fullName: string;
      phone: string | null;
      role: string;
      pricingView: boolean;
      clientId: string | null;
    }) => {
      if (u.id !== actorId && !participants.some((p) => p.id === u.id)) participants.push(u);
    };

    const regionalCreator = order.createdBy;
    const hoUsers = order.client.users.filter((u) => u.role === 'CLIENT_HEAD_OFFICE');
    const opsUsers = await tx.user.findMany({ where: { role: 'PRINTORIA_OPS', deletedAt: null, status: 'ACTIVE' } });
    const salesUsers = await tx.user.findMany({ where: { role: 'PRINTORIA_SALES', deletedAt: null, status: 'ACTIVE' } });

    switch (action) {
      case 'approve_requirement':
        push(regionalCreator);
        break;
      case 'return_for_clarification':
      case 'reject_requirement':
        push(regionalCreator);
        for (const u of hoUsers) push(u);
        break;
      case 'submit_quotation':
        for (const u of hoUsers) push(u);
        break;
      case 'approve_quotation':
      case 'request_revision':
      case 'reject_quotation':
        for (const u of salesUsers) push(u);
        if (action === 'approve_quotation') push(regionalCreator);
        break;
      case 'upload_po':
        for (const u of opsUsers) push(u);
        break;
      case 'raise_po_query':
        for (const u of hoUsers) push(u);
        break;
      case 'confirm_order':
        push(regionalCreator);
        for (const u of hoUsers) push(u);
        for (const u of salesUsers) push(u);
        break;
      case 'start_production':
      case 'start_qc':
      case 'dispatch':
      case 'mark_delivered':
        push(regionalCreator);
        for (const u of hoUsers) push(u);
        break;
      case 'cancel_order':
        push(regionalCreator);
        for (const u of hoUsers) push(u);
        for (const u of [...opsUsers, ...salesUsers]) push(u);
        break;
      default:
        break;
    }
    return participants;
  }

  async enqueue(tx: Prisma.TransactionClient, input: EnqueueInput): Promise<void> {
    const notifSettings = await this.settings.get<{
      email: boolean;
      whatsapp: boolean;
      criticalAlwaysSend: boolean;
    }>('notifications');
    const clientId = await tx.order.findUnique({
      where: { id: input.orderId },
      select: { clientId: true },
    });
    const prefs = clientId
      ? await tx.clientNotificationPrefs.findUnique({ where: { clientId: clientId.clientId } })
      : null;

    for (const recipient of input.recipients) {
      const critical = CRITICAL_TEMPLATES.has(input.templateKey);
      const emailAllowed =
        (prefs?.emailAlerts ?? true) || (critical && notifSettings.criticalAlwaysSend);

      const rendered = renderNotification(input.templateKey, input.ctx);
      // Regional staff can never see pricing — strip it from their copy too.
      const payloadable = isRegional(recipient) ? stripRestricted(input.payload ?? {}) : (input.payload ?? {});
      const payloadJson = payloadable as Prisma.InputJsonValue;

      if (emailAllowed) {
        const row = await tx.notificationLog.create({
          data: {
            orderId: input.orderId,
            recipientId: recipient.id,
            channel: 'email',
            templateKey: input.templateKey,
            toAddress: recipient.email,
            status: 'QUEUED',
            payload: payloadJson,
          },
        });
        // Send inline (tiny latency in local/Resend) so the row arrives at its
        // final state together with the workflow change — no after-commit race.
        try {
          await this.mail.send({
            to: recipient.email,
            subject: rendered.subject,
            text: rendered.text,
            html: rendered.html,
          });
          await tx.notificationLog.update({
            where: { id: row.id },
            data: { status: 'SENT', sentAt: new Date(), attempts: 1 },
          });
        } catch (err) {
          await tx.notificationLog.update({
            where: { id: row.id },
            data: {
              status: 'FAILED',
              attempts: 1,
              lastError: err instanceof Error ? err.message : 'send failed',
            },
          });
          this.logger.warn(`email send failed for ${recipient.email}: ${String(err)}`);
        }
      } else {
        await tx.notificationLog.create({
          data: {
            orderId: input.orderId,
            recipientId: recipient.id,
            channel: 'email',
            templateKey: input.templateKey,
            toAddress: recipient.email,
            status: 'MUTED',
            lastError: 'emailAlerts off for this client',
            payload: payloadJson,
          },
        });
      }

      if (prefs?.whatsappAlerts ?? false) {
        const waPayload = payloadJson;
        if (!this.whatsapp.active) {
          // gateway off — keep the row visible as pending work (queued)
          await tx.notificationLog.create({
            data: {
              orderId: input.orderId,
              recipientId: recipient.id,
              channel: 'whatsapp',
              templateKey: input.templateKey,
              toPhone: recipient.phone,
              status: 'QUEUED',
              lastError: 'whatsapp channel not configured yet',
              payload: waPayload,
            },
          });
        } else if (!recipient.phone) {
          await tx.notificationLog.create({
            data: {
              orderId: input.orderId,
              recipientId: recipient.id,
              channel: 'whatsapp',
              templateKey: input.templateKey,
              status: 'FAILED',
              lastError: 'no phone number on the recipient profile',
              payload: waPayload,
            },
          });
        } else {
          const row = await tx.notificationLog.create({
            data: {
              orderId: input.orderId,
              recipientId: recipient.id,
              channel: 'whatsapp',
              templateKey: input.templateKey,
              toPhone: recipient.phone,
              status: 'QUEUED',
              payload: waPayload,
            },
          });
          // Same inline-send contract as email: the row reaches its final state
          // with the workflow change, so the feed never shows a stuck queue.
          try {
            await this.whatsapp.send({
              to: recipient.phone,
              text: `${rendered.subject}\n\n${rendered.text}`,
            });
            await tx.notificationLog.update({
              where: { id: row.id },
              data: { status: 'SENT', sentAt: new Date(), attempts: 1, lastError: null },
            });
          } catch (err) {
            await tx.notificationLog.update({
              where: { id: row.id },
              data: {
                status: 'FAILED',
                attempts: 1,
                lastError: err instanceof Error ? err.message : 'whatsapp send failed',
              },
            });
            this.logger.warn(`whatsapp send failed for ${recipient.phone}: ${String(err)}`);
          }
        }
      }
    }
  }

  async listMine(user: { id: string }, take: number) {
    const rows = await this.prisma.notificationLog.findMany({
      where: { recipientId: user.id },
      orderBy: { queuedAt: 'desc' },
      take,
      include: { order: { select: { orderNumber: true, title: true } } },
    });
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  }

  async listForOrder(orderId: string, take: number) {
    const rows = await this.prisma.notificationLog.findMany({
      where: { orderId },
      orderBy: { queuedAt: 'desc' },
      take,
      include: {
        order: { select: { orderNumber: true, title: true } },
        recipient: { select: { email: true, fullName: true, role: true } },
      },
    });
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  }

  async getPrefs(clientId: string) {
    const prefs = await this.prisma.clientNotificationPrefs.findUnique({
      where: { clientId },
    });
    if (prefs) return prefs;
    // defaults mirror the DB defaults; row is created on first PUT
    return {
      clientId,
      emailAlerts: true,
      whatsappAlerts: true,
      dailyPendingReminder: true,
      updatedById: null,
      updatedAt: new Date(),
    };
  }

  async updatePrefs(
    user: SessionUser,
    dto: { emailAlerts?: boolean; whatsappAlerts?: boolean; dailyPendingReminder?: boolean },
  ) {
    if (!hasPermission(user.permissions, 'profile.edit')) {
      throw new ForbiddenException('Only Head Office can change client alert preferences.');
    }
    if (!user.clientId) throw new BadRequestException('Your account is not linked to a client.');
    const saved = await this.prisma.clientNotificationPrefs.upsert({
      where: { clientId: user.clientId },
      create: {
        clientId: user.clientId,
        emailAlerts: dto.emailAlerts ?? true,
        whatsappAlerts: dto.whatsappAlerts ?? true,
        dailyPendingReminder: dto.dailyPendingReminder ?? true,
        updatedById: user.id,
      },
      update: {
        ...(dto.emailAlerts !== undefined ? { emailAlerts: dto.emailAlerts } : {}),
        ...(dto.whatsappAlerts !== undefined ? { whatsappAlerts: dto.whatsappAlerts } : {}),
        ...(dto.dailyPendingReminder !== undefined
          ? { dailyPendingReminder: dto.dailyPendingReminder }
          : {}),
        updatedById: user.id,
      },
    });
    return saved;
  }
}

function isRegional(r: ResolvedRecipient): boolean {
  return r.role === 'CLIENT_REGIONAL';
}

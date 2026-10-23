import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface CancellationRules {
  clientHoUntil: string;
  printoriaOpsUntil: string;
  chargesAfterPo: boolean;
  regionalMayCancel: boolean;
}

export interface DelayThresholds {
  default: number;
  perStage: Record<string, number>;
}

export interface PostConfirmationChanges {
  allowQty: boolean;
  allowSpec: boolean;
  requireReason: boolean;
}

export interface FulfilmentVisibility {
  showToClient: boolean;
  visibleStatuses: string[];
}

export interface NotificationsSettings {
  email: boolean;
  whatsapp: boolean;
  reminderIntervalHours: number;
  criticalAlwaysSend: boolean;
}

export interface UploadsSettings {
  maxMb: number;
  allowedExt: string[];
}

export const SETTING_KEYS = [
  'delay_threshold_hours',
  'cancellation_rules',
  'post_confirmation_changes',
  'fulfilment_visibility',
  'notifications',
  'uploads',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/** Mirrors the seed values so a missing row can never crash the workflow. */
const SETTINGS_DEFAULTS: Record<SettingKey, unknown> = {
  delay_threshold_hours: { default: 48, perStage: { ORDER_CONFIRMED: 72, PO_RECEIVED: 24 } },
  cancellation_rules: {
    clientHoUntil: 'PO_RECEIVED',
    printoriaOpsUntil: 'QUALITY_CHECK',
    chargesAfterPo: true,
    regionalMayCancel: true,
  },
  post_confirmation_changes: { allowQty: false, allowSpec: false, requireReason: true },
  fulfilment_visibility: {
    showToClient: true,
    visibleStatuses: ['IN_PRODUCTION', 'QUALITY_CHECK', 'DISPATCHED'],
  },
  notifications: {
    email: true,
    whatsapp: true,
    reminderIntervalHours: 24,
    criticalAlwaysSend: true,
  },
  uploads: {
    maxMb: 25,
    allowedExt: ['pdf', 'jpg', 'jpeg', 'png', 'xlsx', 'docx', 'ai', 'cdr'],
  },
};

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get<T>(key: SettingKey): Promise<T> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    if (row) return row.value as T;
    if (!(key in SETTINGS_DEFAULTS)) {
      throw new NotFoundException(`Unknown setting: ${key}`);
    }
    return SETTINGS_DEFAULTS[key] as T;
  }

  async all(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.setting.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const merged: Record<string, unknown> = {};
    for (const key of SETTING_KEYS) {
      merged[key] = byKey.get(key) ?? SETTINGS_DEFAULTS[key];
    }
    return merged;
  }

  async update(key: string, value: unknown, actorId: string): Promise<void> {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) {
      throw new BadRequestException(`Unknown setting key: ${key}`);
    }
    if (value === null || typeof value !== 'object') {
      throw new BadRequestException('Setting value must be an object.');
    }
    const before = await this.prisma.setting.findUnique({ where: { key } });
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: value as object, updatedById: actorId },
      update: { value: value as object, updatedById: actorId },
    });
    await this.audit.record({
      actorId,
      entityType: 'Setting',
      entityId: key,
      action: 'settings.update',
      before: before?.value ?? null,
      after: value,
    });
  }

  cancellationRules(): Promise<CancellationRules> {
    return this.get<CancellationRules>('cancellation_rules');
  }

  fulfilmentVisibility(): Promise<FulfilmentVisibility> {
    return this.get<FulfilmentVisibility>('fulfilment_visibility');
  }

  /** Non-sensitive knobs used by the web UI. */
  async publicSettings(): Promise<Record<string, unknown>> {
    const [uploads, fulfilmentVisibility, notifications] = await Promise.all([
      this.get<UploadsSettings>('uploads'),
      this.get<FulfilmentVisibility>('fulfilment_visibility'),
      this.get<NotificationsSettings>('notifications'),
    ]);
    return {
      uploads,
      fulfilmentVisibility,
      notifications: {
        email: notifications.email,
        whatsapp: notifications.whatsapp,
      },
    };
  }
}

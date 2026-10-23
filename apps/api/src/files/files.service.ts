import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/auth.types';
import { OrderScopeService } from '../orders/order-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService, type UploadsSettings } from '../settings/settings.service';
import { LocalDiskStorageService } from '../storage/local-disk-storage.service';
import { STORAGE_PROVIDER } from '../storage/storage-provider';
import type { StorageProvider } from '../storage/storage-provider';
import type { FileEntityType, FileKind } from './dto/files.dto';

interface FileRow {
  id: string;
  entityType: string;
  entityId: string;
  kind: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  checksum: string | null;
  scanStatus: string;
  createdAt: Date;
}

const slimFile = (f: FileRow) => ({
  id: f.id,
  entityType: f.entityType,
  entityId: f.entityId,
  kind: f.kind,
  originalName: f.originalName,
  mime: f.mime,
  sizeBytes: f.sizeBytes,
  checksum: f.checksum,
  scanStatus: f.scanStatus,
  createdAt: f.createdAt,
});

type ScopedOrder = { id: string; clientId: string; regionId: string };

/** Human-facing artifacts (PO PDFs, spec sheets, reference images). */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly scope: OrderScopeService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly localDisk: LocalDiskStorageService,
  ) {}

  /**
   * Uploads an artifact. Validation is driven by DB-backed `uploads` settings;
   * the virus-scan hook is a dev passthrough (row goes PENDING → CLEAN).
   */
  async upload(
    user: SessionUser,
    file: Express.Multer.File | undefined,
    dto: { entityType: FileEntityType; entityId?: string; kind: FileKind; description?: string },
  ): Promise<ReturnType<typeof slimFile>> {
    if (!file) throw new BadRequestException('No file received in the "file" form field.');

    const order = await this.resolveEntityOrder(user, dto.entityType, dto.entityId);

    const uploads = await this.settings.get<UploadsSettings>('uploads');
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    if (!(uploads.allowedExt ?? []).includes(ext)) {
      throw new UnsupportedMediaTypeException(
        `Files of type .${ext || '(none)'} are not allowed (allowed: ${(uploads.allowedExt ?? []).join(', ')}).`,
      );
    }
    const maxBytes = (uploads.maxMb ?? 25) * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new PayloadTooLargeException(`File exceeds the ${uploads.maxMb ?? 25} MB upload limit.`);
    }

    const key = LocalDiskStorageService.newKey(ext);
    const stored = await this.storage.put(file.buffer, key);
    const created = await this.prisma.file.create({
      data: {
        entityType: dto.entityType,
        entityId: order.entityId,
        kind: dto.kind,
        originalName: file.originalname.slice(0, 200),
        s3Key: key,
        mime: file.mimetype || 'application/octet-stream',
        sizeBytes: stored.size,
        checksum: stored.checksum,
        scanStatus: 'CLEAN',
        uploadedById: user.id,
      },
    });
    await this.audit.record({
      actorId: user.id,
      entityType: 'FILE',
      entityId: created.id,
      action: 'file.uploaded',
      after: {
        orderId: order.id,
        fileKind: dto.kind,
        entityType: created.entityType,
        entityId: created.entityId,
        sizeBytes: created.sizeBytes,
        originalName: created.originalName,
      },
    });
    return slimFile(created as unknown as FileRow);
  }

  /** Lists every artifact attached to an order (through all its entities). */
  async listForOrder(user: SessionUser, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null, ...this.scope.whereFor(user) },
      select: { id: true, clientId: true, regionId: true },
    });
    if (!order) throw new NotFoundException('Order not found.');

    const [rvIds, qIds, poIds] = await Promise.all([
      this.prisma.requirementVersion.findMany({
        where: { orderId: order.id, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.quotation.findMany({ where: { orderId: order.id, deletedAt: null }, select: { id: true } }),
      this.prisma.purchaseOrder.findMany({ where: { orderId: order.id, deletedAt: null }, select: { id: true } }),
    ]);

    const pairs: { entityType: FileEntityType; entityId: string }[] = [
      { entityType: 'ORDER', entityId: order.id },
      ...rvIds.map((rv) => ({ entityType: 'REQUIREMENT_VERSION' as const, entityId: rv.id })),
      ...qIds.map((q) => ({ entityType: 'QUOTATION' as const, entityId: q.id })),
      ...poIds.map((po) => ({ entityType: 'PURCHASE_ORDER' as const, entityId: po.id })),
    ];

    const rows = await this.prisma.file.findMany({
      where: {
        deletedAt: null,
        OR: pairs.map((p) => ({ entityType: p.entityType, entityId: p.entityId })),
      },
      orderBy: { createdAt: 'desc' },
    });

    // regional accounts never see PO paperwork (hard rule, mirrors the checklist)
    const visible =
      user.role === 'CLIENT_REGIONAL'
        ? rows.filter((r) => r.kind !== 'po_document' && r.entityType !== 'PURCHASE_ORDER')
        : rows;
    return { orderId: order.id, files: visible.map((r) => slimFile(r as FileRow)) };
  }

  /** Tenancy + regional-PO guard, then the stored bytes. */
  async download(
    user: SessionUser,
    fileId: string,
  ): Promise<{ file: ReturnType<typeof slimFile>; bytes: Buffer }> {
    const file = await this.prisma.file.findFirst({ where: { id: fileId, deletedAt: null } });
    if (!file) throw new NotFoundException('File not found.');

    await this.resolveEntityOrder(user, file.entityType as FileEntityType, file.entityId ?? '');
    if (user.role === 'CLIENT_REGIONAL' && (file.kind === 'po_document' || file.entityType === 'PURCHASE_ORDER')) {
      throw new ForbiddenException('Purchase-order documents are visible to head office only.');
    }

    const bytes = await this.storage.get(file.s3Key);
    return { file: slimFile(file as FileRow), bytes };
  }

  /** Maps an upload target onto its owning order (404 if not tenant-visible). */
  private async resolveEntityOrder(
    user: SessionUser,
    entityType: FileEntityType,
    entityId = '',
  ): Promise<{ id: string; entityId: string; order: ScopedOrder }> {
    const pick = (selectArg?: Prisma.OrderSelect) =>
      ({
        id: true,
        clientId: true,
        regionId: true,
        ...(selectArg ?? {}),
      }) as Prisma.OrderSelect;

    if (entityType === 'ORDER') {
      const order = await this.prisma.order.findFirst({
        where: { id: entityId, deletedAt: null, ...this.scope.whereFor(user) },
        select: pick() as Prisma.OrderSelect,
      });
      if (!order) throw new NotFoundException('Order not found.');
      const scoped = order as unknown as ScopedOrder;
      return { id: scoped.id, entityId: scoped.id, order: scoped };
    }

    const map = {
      REQUIREMENT_VERSION: {
        model: 'requirementVersion',
        relation: 'order',
      },
      QUOTATION: { model: 'quotation', relation: 'order' },
      PURCHASE_ORDER: {
        model: 'purchaseOrder',
        relation: 'order',
      },
    } as const;
    const meta = map[entityType];
    if (!meta) throw new NotFoundException('Unknown file entity.');

    const delegate = (this.prisma as unknown as Record<string, { findFirst: (args: unknown) => Promise<unknown> }>)[
      meta.model
    ];
    const row = (await delegate.findFirst({
      where: { id: entityId, deletedAt: null },
      include: { [meta.relation]: { select: { id: true, clientId: true, regionId: true } } },
    })) as { [k: string]: unknown } | null;
    if (!row) {
      throw new NotFoundException(`${entityType.replace(/_/g, ' ').toLowerCase()} not found.`);
    }
    const order = row[meta.relation] as ScopedOrder | null;
    if (!order) throw new NotFoundException(`${meta.relation} not found.`);
    this.scope.assertCanView(order, user);
    return { id: order.id, entityId: entityId, order };
  }
}

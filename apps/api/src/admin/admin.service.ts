import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@pintoria/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type {
  CreateClientDto,
  CreateRegionDto,
  CreateUserDto,
  UpdateClientDto,
  UpdateRegionDto,
  UpdateUserDto,
} from './dto/admin.dto';

const CLIENT_ROLES: UserRole[] = ['CLIENT_REGIONAL', 'CLIENT_HEAD_OFFICE'];

const slimUser = (
  u: Prisma.UserGetPayload<Record<string, never>> & {
    client?: { name: string } | null;
    region?: { name: string } | null;
  },
) => ({
  id: u.id,
  email: u.email,
  fullName: u.fullName,
  role: u.role,
  status: u.status,
  phone: u.phone,
  pricingView: u.pricingView,
  clientId: u.clientId,
  clientName: u.client?.name ?? null,
  regionId: u.regionId,
  regionName: u.region?.name ?? null,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});

/** Admin-back-office CRUD: clients, regions, users (+ invitations). */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  // ---------- clients ----------

  async listClients(q: { q?: string; status?: string }) {
    const where: Prisma.ClientWhereInput = {
      deletedAt: null,
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { code: { contains: q.q, mode: 'insensitive' } }] } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const rows = await this.prisma.client.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { regions: true, users: { where: { deletedAt: null } }, orders: { where: { deletedAt: null } } } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      status: c.status,
      industry: c.industry,
      paymentTerms: c.paymentTerms,
      city: c.city,
      businessEmail: c.businessEmail,
      regionCount: c._count.regions,
      userCount: c._count.users,
      orderCount: c._count.orders,
      createdAt: c.createdAt,
    }));
  }

  async createClient(dto: CreateClientDto, actorId: string) {
    const code = dto.code.trim().toUpperCase();
    await this.assertUniqueClientCode(code);
    const client = await this.prisma.client.create({
      data: {
        name: dto.name.trim(),
        code,
        industry: dto.industry ?? null,
        paymentTerms: dto.paymentTerms ?? null,
        registeredAddress: dto.registeredAddress ?? null,
        city: dto.city ?? null,
        state: dto.state ?? null,
        businessEmail: dto.businessEmail ?? null,
      },
    });
    await this.audit.record({ actorId, entityType: 'Client', entityId: client.id, action: 'client.create', after: { code } });
    return client;
  }

  async updateClient(id: string, dto: UpdateClientDto, actorId: string) {
    const existing = await this.findClient(id);
    const before = { name: existing.name, status: existing.status, paymentTerms: existing.paymentTerms };
    const client = await this.prisma.client.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.industry !== undefined ? { industry: dto.industry } : {}),
        ...(dto.paymentTerms !== undefined ? { paymentTerms: dto.paymentTerms } : {}),
        ...(dto.registeredAddress !== undefined ? { registeredAddress: dto.registeredAddress } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.state !== undefined ? { state: dto.state } : {}),
        ...(dto.businessEmail !== undefined ? { businessEmail: dto.businessEmail } : {}),
      },
    });
    if (dto.status === 'INACTIVE') {
      // suspended clients cannot log in; kill their sessions now
      await this.prisma.refreshToken.updateMany({
        where: { user: { clientId: id }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit.record({ actorId, entityType: 'Client', entityId: id, action: 'client.update', before, after: { name: client.name, status: client.status } });
    return client;
  }

  async deleteClient(id: string, actorId: string) {
    const existing = await this.findClient(id);
    const openOrders = await this.prisma.order.count({ where: { clientId: id, deletedAt: null } });
    if (openOrders > 0) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Client ${existing.code} still has ${openOrders} order(s). Close or cancel them before deleting.`,
      });
    }
    await this.prisma.$transaction([
      this.prisma.client.update({ where: { id }, data: { deletedAt: new Date() } }),
      this.prisma.region.updateMany({ where: { clientId: id, deletedAt: null }, data: { deletedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({
        where: { user: { clientId: id }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({ actorId, entityType: 'Client', entityId: id, action: 'client.delete', before: { code: existing.code } });
    return { ok: true };
  }

  // ---------- regions ----------

  async listRegions(clientId: string) {
    await this.findClient(clientId);
    const rows = await this.prisma.region.findMany({
      where: { clientId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: { where: { deletedAt: null } }, orders: { where: { deletedAt: null } } } } },
    });
    return rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      name: r.name,
      code: r.code,
      city: r.city,
      managerName: r.managerName,
      managerEmail: r.managerEmail,
      userCount: r._count.users,
      orderCount: r._count.orders,
    }));
  }

  async createRegion(dto: CreateRegionDto, actorId: string) {
    await this.findClient(dto.clientId);
    await this.assertUniqueRegionCode(dto.clientId, dto.code.trim().toUpperCase());
    const region = await this.prisma.region.create({
      data: {
        clientId: dto.clientId,
        name: dto.name.trim(),
        code: dto.code.trim().toUpperCase(),
        city: dto.city ?? null,
        managerName: dto.managerName ?? null,
        managerEmail: dto.managerEmail ?? null,
      },
    });
    await this.audit.record({ actorId, entityType: 'Region', entityId: region.id, action: 'region.create', after: { code: region.code } });
    return region;
  }

  async updateRegion(id: string, dto: UpdateRegionDto, actorId: string) {
    const existing = await this.findRegion(id);
    const region = await this.prisma.region.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.managerName !== undefined ? { managerName: dto.managerName } : {}),
        ...(dto.managerEmail !== undefined ? { managerEmail: dto.managerEmail } : {}),
      },
    });
    await this.audit.record({ actorId, entityType: 'Region', entityId: id, action: 'region.update', before: { name: existing.name }, after: { name: region.name } });
    return region;
  }

  async deleteRegion(id: string, actorId: string) {
    const existing = await this.findRegion(id);
    const openOrders = await this.prisma.order.count({ where: { regionId: id, deletedAt: null } });
    if (openOrders > 0) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Region ${existing.code} still has ${openOrders} order(s). Close or cancel them before deleting.`,
      });
    }
    await this.prisma.region.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({ actorId, entityType: 'Region', entityId: id, action: 'region.delete', before: { code: existing.code } });
    return { ok: true };
  }

  // ---------- users ----------

  async listUsers(q: { clientId?: string; role?: UserRole; status?: string; q?: string }) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.role ? { role: q.role } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { fullName: { contains: q.q, mode: 'insensitive' } }] }
        : {}),
    };
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ fullName: 'asc' }],
      include: { client: { select: { name: true } }, region: { select: { name: true } } },
    });
    return rows.map(slimUser);
  }

  async createUser(dto: CreateUserDto, actorId: string) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (existing) {
      throw new ConflictException({ code: 'CONFLICT', message: 'A user with this email already exists.' });
    }

    let regionId: string | null = null;
    let clientId: string | null = null;
    if (CLIENT_ROLES.includes(dto.role)) {
      if (!dto.clientId) {
        throw new BadRequestException('Client roles must be assigned to a client.');
      }
      const client = await this.findClient(dto.clientId);
      clientId = client.id;
      if (dto.role === 'CLIENT_REGIONAL') {
        if (!dto.regionId) throw new BadRequestException('Regional users must be assigned to a region of their client.');
        const region = await this.findRegion(dto.regionId);
        if (region.clientId !== client.id) {
          throw new BadRequestException('The region belongs to a different client.');
        }
        regionId = region.id;
      }
    } else if (dto.clientId || dto.regionId) {
      throw new BadRequestException('Printoria staff accounts are not attached to a client.');
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        fullName: dto.fullName.trim(),
        role: dto.role,
        clientId,
        regionId,
        phone: dto.phone ?? null,
        // hard rule: regional accounts can never hold pricing view
        pricingView: dto.role === 'CLIENT_REGIONAL' ? false : (dto.pricingView ?? false),
        passwordHash: 'PENDING:INVITE',
        status: 'PENDING',
      },
    });
    // invitation email is part of account creation (48h link, same flow as 1a)
    const invite = await this.auth.createInvitation(user.id, actorId);
    return { ...slimUser(user), invitation: invite };
  }

  async updateUser(id: string, dto: UpdateUserDto, actorId: string) {
    const existing = await this.findUser(id);
    if (existing.role === 'CLIENT_REGIONAL' && dto.pricingView) {
      // hard rule: a regional account can never hold pricing view
      throw new ForbiddenException('Regional users can never hold pricing view.');
    }
    let regionId = existing.regionId;
    if (dto.regionId && dto.regionId !== existing.regionId) {
      const region = await this.findRegion(dto.regionId);
      if (region.clientId !== existing.clientId) {
        throw new BadRequestException('The region belongs to a different client.');
      }
      regionId = region.id;
    }
    const status = dto.status ?? existing.status;
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.regionId !== undefined ? { regionId } : {}),
        ...(dto.pricingView !== undefined ? { pricingView: dto.pricingView } : {}),
        ...(dto.status !== undefined ? { status } : {}),
      },
    });
    if (status !== 'ACTIVE') {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit.record({
      actorId,
      entityType: 'User',
      entityId: id,
      action: 'user.update',
      before: { status: existing.status, regionId: existing.regionId, pricingView: existing.pricingView },
      after: { status: user.status, regionId, pricingView: dto.pricingView ?? existing.pricingView },
    });
    return slimUser(user);
  }

  async resendInvite(id: string, actorId: string) {
    const user = await this.findUser(id);
    if (user.status !== 'PENDING') {
      throw new BadRequestException('This account already has a password. Use password reset instead.');
    }
    return this.auth.createInvitation(id, actorId);
  }

  // ---------- private ----------

  private async findClient(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Client not found.');
    const client = await this.prisma.client.findFirst({ where: { id, deletedAt: null } });
    if (!client) throw new NotFoundException('Client not found.');
    return client;
  }

  private async findRegion(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('Region not found.');
    const region = await this.prisma.region.findFirst({ where: { id, deletedAt: null } });
    if (!region) throw new NotFoundException('Region not found.');
    return region;
  }

  private async findUser(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException('User not found.');
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { client: { select: { name: true } }, region: { select: { name: true } } },
    });
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  private async assertUniqueClientCode(code: string) {
    const dupe = await this.prisma.client.findFirst({ where: { code, deletedAt: null } });
    if (dupe) {
      throw new ConflictException({ code: 'CONFLICT', message: `Client code ${code} is already in use.` });
    }
  }

  private async assertUniqueRegionCode(clientId: string, code: string) {
    const dupe = await this.prisma.region.findFirst({
      where: { clientId, code, deletedAt: null },
    });
    if (dupe) {
      throw new ConflictException({ code: 'CONFLICT', message: `Region code ${code} already exists for this client.` });
    }
  }
}

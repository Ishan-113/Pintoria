import type { Request } from 'express';
import type { SessionUserDto, UserRole } from '@pintoria/shared';
import { computeEffectivePermissions } from '@pintoria/shared';

export type SessionUser = SessionUserDto;

export interface AuthRequest extends Request {
  user?: SessionUser;
}

export interface JwtPayload {
  sub: string;
}

export interface SessionUserSource {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  clientId: string | null;
  regionId: string | null;
  pricingView: boolean;
}

export function buildSessionUser(u: SessionUserSource): SessionUser {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    clientId: u.clientId,
    regionId: u.regionId,
    pricingView: u.pricingView,
    permissions: computeEffectivePermissions(u.role, { pricingView: u.pricingView }),
  };
}

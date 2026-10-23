import type { Permission, UserRole } from './enums';

/** Permissions each role holds by default (PT_OPS pricing is per-user, via `pricing_view`). */
export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, Permission[]> = {
  CLIENT_REGIONAL: [
    'order.create',
    'order.view',
    'requirement.update',
    'order.cancel',
    'profile.view',
  ],
  CLIENT_HEAD_OFFICE: [
    'order.view',
    'order.cancel',
    'requirement.decide',
    'quotation.decide',
    'po.upload',
    'pricing.view',
    'profile.view',
    'profile.edit',
  ],
  PRINTORIA_SALES: [
    'order.view',
    'quotation.manage',
    'pricing.view',
    'profile.view',
  ],
  PRINTORIA_OPS: [
    'order.view',
    'po.verify',
    'order.confirm',
    'fulfilment.advance',
    'order.cancel',
    'profile.view',
  ],
  PRINTORIA_ADMIN: [
    'order.view',
    'order.cancel',
    'pricing.view',
    'profile.view',
    'profile.edit',
    'admin.clients',
    'admin.regions',
    'admin.users',
    'admin.settings',
    'audit.view',
    'notification.manage',
  ],
};

/**
 * Effective permissions for a session.
 * Hard rules, enforced even against future per-user overrides:
 *  - CLIENT_REGIONAL can NEVER hold `pricing.view` or `profile.edit`.
 *  - CLIENT_* roles can never hold admin.* permissions.
 *  - Printoria staff get `pricing.view` only via the per-user flag.
 */
export function computeEffectivePermissions(
  role: UserRole,
  opts: { pricingView?: boolean; extra?: Permission[] } = {},
): Permission[] {
  const set = new Set<Permission>(ROLE_DEFAULT_PERMISSIONS[role] ?? []);

  if (role !== 'CLIENT_REGIONAL' && opts.pricingView === true) {
    if (role !== 'CLIENT_HEAD_OFFICE') set.add('pricing.view');
  }

  for (const p of opts.extra ?? []) set.add(p);

  if (role === 'CLIENT_REGIONAL') {
    set.delete('pricing.view');
    set.delete('profile.edit');
  }
  if (role.startsWith('CLIENT_')) {
    for (const p of ['admin.clients', 'admin.regions', 'admin.users', 'admin.settings', 'audit.view', 'notification.manage'] as Permission[]) {
      set.delete(p);
    }
  }
  // Cancel rules are settings-driven; regional cancel is gated at the action level later.
  if (role === 'CLIENT_REGIONAL') set.delete('order.cancel');

  return [...set].sort();
}

export function hasPermission(
  held: Permission[],
  needed: Permission | Permission[],
): boolean {
  const list = Array.isArray(needed) ? needed : [needed];
  return list.some((p) => held.includes(p));
}

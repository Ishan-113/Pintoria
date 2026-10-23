import { computeEffectivePermissions } from '@pintoria/shared';

describe('computeEffectivePermissions (role matrix)', () => {
  it('head office sees pricing and can decide requirements/quotations, upload POs', () => {
    const p = computeEffectivePermissions('CLIENT_HEAD_OFFICE');
    expect(p).toContain('pricing.view');
    expect(p).toContain('requirement.decide');
    expect(p).toContain('quotation.decide');
    expect(p).toContain('po.upload');
    expect(p).toContain('profile.edit');
    expect(p).not.toContain('admin.clients');
    expect(p).not.toContain('order.create');
  });

  it('regional user can never hold pricing.view or profile.edit, even if pricingView=true', () => {
    const p = computeEffectivePermissions('CLIENT_REGIONAL', { pricingView: true });
    expect(p).not.toContain('pricing.view');
    expect(p).not.toContain('profile.edit');
    expect(p).toContain('order.create');
    expect(p).toContain('order.view');
    expect(p).toContain('requirement.update');
    // cancellation is gated at action level later (settings-driven)
    expect(p).not.toContain('order.cancel');
  });

  it('sales can quote but not verify POs or admin', () => {
    const p = computeEffectivePermissions('PRINTORIA_SALES');
    expect(p).toContain('quotation.manage');
    expect(p).toContain('pricing.view');
    expect(p).not.toContain('po.verify');
    expect(p).not.toContain('admin.users');
  });

  it('operations cannot see pricing unless the per-user flag grants it', () => {
    const without = computeEffectivePermissions('PRINTORIA_OPS');
    expect(without).not.toContain('pricing.view');
    expect(without).toContain('po.verify');

    const withFlag = computeEffectivePermissions('PRINTORIA_OPS', { pricingView: true });
    expect(withFlag).toContain('pricing.view');
  });

  it('printoria admin holds admin.* and audit.view', () => {
    const p = computeEffectivePermissions('PRINTORIA_ADMIN', { pricingView: true });
    expect(p).toContain('admin.clients');
    expect(p).toContain('admin.users');
    expect(p).toContain('admin.settings');
    expect(p).toContain('audit.view');
    expect(p).toContain('pricing.view');
  });
});

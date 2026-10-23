import { useEffect, useState } from 'react';
import { USER_ROLES } from '@pintoria/shared';
import type { UserRole } from '@pintoria/shared';
import * as api from '../api/endpoints';
import { Banner, Card, Empty, ErrBanner, Field } from '../components/ui';

const CLIENT_ROLES: UserRole[] = ['CLIENT_REGIONAL', 'CLIENT_HEAD_OFFICE'];

export function AdminUsers() {
  const [clients, setClients] = useState<api.ClientRow[]>([]);
  const [regions, setRegions] = useState<api.RegionRow[]>([]);
  const [rows, setRows] = useState<api.UserRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState({ clientId: '', role: '', q: '' });
  const [form, setForm] = useState({
    email: '',
    fullName: '',
    role: 'CLIENT_REGIONAL' as UserRole,
    clientId: '',
    regionId: '',
    phone: '',
    pricingView: false,
  });
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  useEffect(() => {
    api
      .listClients()
      .then(setClients)
      .catch(setError);
  }, []);

  const load = (f: typeof filters) => {
    api
      .listUsers({ clientId: f.clientId || undefined, role: f.role || undefined, q: f.q || undefined })
      .then(setRows)
      .catch(setError);
  };
  useEffect(() => {
    load(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // regions of the selected client (for the create form dropdown)
  useEffect(() => {
    if (!form.clientId) {
      setRegions([]);
      return;
    }
    api
      .listRegions(form.clientId)
      .then(setRegions)
      .catch(() => setRegions([]));
  }, [form.clientId]);

  const isClientRole = CLIENT_ROLES.includes(form.role);
  const canTogglePricing = form.role !== 'CLIENT_REGIONAL';

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const create = async () => {
    setBusy(true);
    setActionError(null);
    setNotice('');
    try {
      const created = await api.createUser({
        email: form.email.trim().toLowerCase(),
        fullName: form.fullName.trim(),
        role: form.role,
        clientId: isClientRole ? form.clientId : undefined,
        regionId: form.role === 'CLIENT_REGIONAL' ? form.regionId || undefined : undefined,
        phone: form.phone.trim() || undefined,
        pricingView: canTogglePricing ? form.pricingView : undefined,
      });
      setForm({ email: '', fullName: '', role: 'CLIENT_REGIONAL', clientId: '', regionId: '', phone: '', pricingView: false });
      setInviteLink(created.invitation?.devLink ?? null);
      setNotice(`Invitation ${created.invitation?.sent ? 'sent' : 'queued'} for ${created.email}.`);
      load(filters);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setActionError(null);
    setNotice('');
    try {
      await fn();
      setNotice(message);
      load(filters);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h2>Users</h2>
      <ErrBanner error={error} />
      <ErrBanner error={actionError} />
      {notice && <Banner kind="ok">{notice}</Banner>}
      {inviteLink && (
        <Banner kind="info">
          Dev invite link (production emails this instead): <code>{inviteLink}</code>
        </Banner>
      )}

      <Card title="Invite a new user">
        <div className="row">
          <Field label="Email">
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
          </Field>
          <Field label="Full name">
            <input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} required />
          </Field>
          <Field label="Role">
            <select value={form.role} onChange={(e) => { set('role', e.target.value as UserRole); set('regionId', ''); }}>
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="row">
          {isClientRole && (
            <Field label="Client">
              <select value={form.clientId} onChange={(e) => { set('clientId', e.target.value); set('regionId', ''); }} required={isClientRole}>
                <option value="">— pick client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {form.role === 'CLIENT_REGIONAL' && (
            <Field label="Region" hint="Must belong to the selected client">
              <select value={form.regionId} onChange={(e) => set('regionId', e.target.value)}>
                <option value="">— pick region —</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Phone">
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          {canTogglePricing && (
            <Field label="Access to pricing">
              <select value={form.pricingView ? 'yes' : 'no'} onChange={(e) => set('pricingView', e.target.value === 'yes')}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>
          )}
          {form.role === 'CLIENT_REGIONAL' && (
            <span className="muted self-end">Regional users never see pricing — enforced server-side.</span>
          )}
        </div>
        <div className="modal-buttons">
          <button
            className="btn primary"
            disabled={busy || !form.email || !form.fullName || (isClientRole && !form.clientId)}
            onClick={create}
          >
            {busy ? 'Sending…' : 'Send invitation'}
          </button>
        </div>
      </Card>

      <div className="filters">
        <Field label="Client">
          <select
            value={filters.clientId}
            onChange={(e) => {
              const next = { ...filters, clientId: e.target.value };
              setFilters(next);
              load(next);
            }}
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Role">
          <select
            value={filters.role}
            onChange={(e) => {
              const next = { ...filters, role: e.target.value };
              setFilters(next);
              load(next);
            }}
          >
            <option value="">All roles</option>
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search">
          <input
            value={filters.q}
            placeholder="Name or email…"
            onChange={(e) => {
              const next = { ...filters, q: e.target.value };
              setFilters(next);
              load(next);
            }}
          />
        </Field>
      </div>

      {rows.length === 0 ? (
        <Empty>No users match these filters.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Client / Region</th>
              <th>Status</th>
              <th>Pricing</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.fullName}</strong>
                </td>
                <td>{u.email}</td>
                <td>{u.role.replace(/_/g, ' ')}</td>
                <td className="muted">
                  {u.clientName ?? '—'}
                  {u.regionName ? ` · ${u.regionName}` : ''}
                </td>
                <td>
                  <span className={`tag ${u.status === 'ACTIVE' ? 'green' : u.status === 'PENDING' ? 'amber' : 'red'}`}>
                    {u.status}
                  </span>
                  {u.lastLoginAt ? <div className="muted">{new Date(u.lastLoginAt).toLocaleDateString()}</div> : null}
                </td>
                <td>{u.pricingView ? 'full' : 'hidden'}</td>
                <td className="row-actions">
                  {u.status === 'PENDING' && (
                    <button className="btn tiny" disabled={busy} onClick={() => act(() => api.resendInvite(u.id), `Invitation re-sent to ${u.email}.`)}>
                      Resend invite
                    </button>
                  )}
                  {u.status === 'ACTIVE' && (
                    <button
                      className="btn tiny danger"
                      disabled={busy}
                      onClick={() => act(() => api.updateUser(u.id, { status: 'SUSPENDED' }), `${u.fullName} suspended.`)}
                    >
                      Suspend
                    </button>
                  )}
                  {u.status === 'SUSPENDED' && (
                    <button
                      className="btn tiny"
                      disabled={busy}
                      onClick={() => act(() => api.updateUser(u.id, { status: 'ACTIVE' }), `${u.fullName} reactivated.`)}
                    >
                      Reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

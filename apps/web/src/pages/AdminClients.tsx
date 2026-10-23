import { useEffect, useState } from 'react';
import * as api from '../api/endpoints';
import { Card, Empty, ErrBanner, ErrorText, Field } from '../components/ui';

const BLANK = { name: '', code: '', industry: '', city: '', businessEmail: '', paymentTerms: '' };

export function AdminClients() {
  const [rows, setRows] = useState<api.ClientRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  const load = (query?: string) => {
    api
      .listClients(query)
      .then(setRows)
      .catch(setError);
  };
  useEffect(() => {
    load();
  }, []);

  if (error) return <ErrorText error={error} />;

  const set = (k: keyof typeof BLANK) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setActionError(null);
    const dto: Record<string, string | undefined> = {
      name: form.name.trim() || undefined,
      code: form.code.trim() || undefined,
      industry: form.industry.trim() || undefined,
      city: form.city.trim() || undefined,
      businessEmail: form.businessEmail.trim() || undefined,
      paymentTerms: form.paymentTerms.trim() || undefined,
    };
    try {
      const base = { ...(editingId ? dto : { ...dto, name: form.name.trim(), code: form.code.trim() }) };
      if (editingId) {
        for (const k of Object.keys(base)) if (!base[k]) delete base[k];
        await api.updateClient(editingId, base);
      } else {
        await api.createClient(base as { name: string; code: string });
      }
      setForm({ ...BLANK });
      setEditingId(null);
      load(q || undefined);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  const deleter = async (id: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await api.deleteClient(id);
      load(q || undefined);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h2>Clients</h2>
      <ErrBanner error={actionError} />

      <div className="filters">
        <Field label="Search">
          <input value={q} onChange={(e) => { setQ(e.target.value); load(e.target.value || undefined); }} placeholder="Name or code…" />
        </Field>
      </div>

      <Card title={editingId ? 'Edit client' : 'Add client'}>
        <div className="row">
          <Field label="Name">
            <input value={form.name} onChange={set('name')} required />
          </Field>
          <Field label="Code" hint="Short unique code, e.g. SUN">
            <input value={form.code} onChange={set('code')} required disabled={!!editingId} />
          </Field>
          <Field label="Industry">
            <input value={form.industry} onChange={set('industry')} />
          </Field>
          <Field label="City">
            <input value={form.city} onChange={set('city')} />
          </Field>
          <Field label="Business email">
            <input type="email" value={form.businessEmail} onChange={set('businessEmail')} />
          </Field>
          <Field label="Default payment terms">
            <input value={form.paymentTerms} onChange={set('paymentTerms')} />
          </Field>
        </div>
        <div className="modal-buttons">
          {editingId && (
            <button className="btn" onClick={() => { setEditingId(null); setForm({ ...BLANK }); }} disabled={busy}>
              Stop editing
            </button>
          )}
          <button className="btn primary" disabled={busy || !form.name.trim() || (!editingId && !form.code.trim())} onClick={save}>
            {busy ? 'Saving…' : editingId ? 'Save changes' : 'Create client'}
          </button>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Empty>No clients yet.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Status</th>
              <th>Regions</th>
              <th>Users</th>
              <th>Orders</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                  <div className="muted">{c.industry ?? ''} {c.city ? `· ${c.city}` : ''}</div>
                </td>
                <td>{c.code}</td>
                <td>
                  <span className={`tag ${c.status === 'ACTIVE' ? 'green' : 'red'}`}>{c.status}</span>
                </td>
                <td>{c.regionCount}</td>
                <td>{c.userCount}</td>
                <td>{c.orderCount}</td>
                <td className="row-actions">
                  <button
                    className="btn tiny"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(c.id);
                      setForm({
                        name: c.name,
                        code: c.code,
                        industry: c.industry ?? '',
                        city: c.city ?? '',
                        businessEmail: c.businessEmail ?? '',
                        paymentTerms: c.paymentTerms ?? '',
                      });
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    Edit
                  </button>
                  {c.status === 'ACTIVE' ? (
                    <button className="btn tiny danger" disabled={busy} onClick={() => deleter(c.id)}>
                      Delete
                    </button>
                  ) : (
                    <span className="muted">deleted</span>
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

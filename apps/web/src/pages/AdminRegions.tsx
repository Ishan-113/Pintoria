import { useEffect, useState } from 'react';
import * as api from '../api/endpoints';
import { Card, Empty, ErrBanner, ErrorText, Field } from '../components/ui';

const BLANK = { name: '', code: '', city: '', managerName: '', managerEmail: '' };

export function AdminRegions() {
  const [clients, setClients] = useState<api.ClientRow[]>([]);
  const [clientId, setClientId] = useState('');
  const [rows, setRows] = useState<api.RegionRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listClients()
      .then((cs) => {
        setClients(cs);
        if (cs.length > 0) setClientId((prev) => prev || cs[0].id);
      })
      .catch(setError);
  }, []);

  const load = (cid: string) => {
    api
      .listRegions(cid)
      .then(setRows)
      .catch(setError);
  };
  useEffect(() => {
    if (clientId) load(clientId);
  }, [clientId]);

  if (error) return <ErrorText error={error} />;

  const set = (k: keyof typeof BLANK) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setActionError(null);
    try {
      if (editingId) {
        const dto: Record<string, string | undefined> = {
          name: form.name.trim() || undefined,
          city: form.city.trim() || undefined,
          managerName: form.managerName.trim() || undefined,
          managerEmail: form.managerEmail.trim() || undefined,
        };
        for (const k of Object.keys(dto)) if (!dto[k]) delete dto[k];
        await api.updateRegion(editingId, dto);
      } else {
        await api.createRegion({
          clientId,
          name: form.name.trim(),
          code: form.code.trim(),
          city: form.city.trim() || undefined,
          managerName: form.managerName.trim() || undefined,
          managerEmail: form.managerEmail.trim() || undefined,
        });
      }
      setForm({ ...BLANK });
      setEditingId(null);
      load(clientId);
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
      await api.deleteRegion(id);
      load(clientId);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h2>Regions</h2>
      <ErrBanner error={actionError} />

      <div className="filters">
        <Field label="Client">
          <select value={clientId} onChange={(e) => { setClientId(e.target.value); setEditingId(null); setForm({ ...BLANK }); }}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {clientId && (
        <Card title={editingId ? 'Edit region' : 'Add region'}>
          <div className="row">
            <Field label="Name">
              <input value={form.name} onChange={set('name')} required />
            </Field>
            <Field label="Code" hint="e.g. WEST / NORTH" >
              <input value={form.code} onChange={set('code')} required disabled={!!editingId} />
            </Field>
            <Field label="City">
              <input value={form.city} onChange={set('city')} />
            </Field>
            <Field label="Manager name">
              <input value={form.managerName} onChange={set('managerName')} />
            </Field>
            <Field label="Manager email">
              <input type="email" value={form.managerEmail} onChange={set('managerEmail')} />
            </Field>
          </div>
          <div className="modal-buttons">
            {editingId && (
              <button className="btn" onClick={() => { setEditingId(null); setForm({ ...BLANK }); }} disabled={busy}>
                Stop editing
              </button>
            )}
            <button className="btn primary" disabled={busy || !form.name.trim() || (!editingId && !form.code.trim())} onClick={save}>
              {busy ? 'Saving…' : editingId ? 'Save changes' : 'Create region'}
            </button>
          </div>
        </Card>
      )}

      {rows.length === 0 ? (
        <Empty>Pick a client — or add its first region.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>City</th>
              <th>Manager</th>
              <th>Users</th>
              <th>Orders</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.name}</strong>
                </td>
                <td>{r.code}</td>
                <td>{r.city ?? '—'}</td>
                <td>
                  {r.managerName ?? '—'}
                  {r.managerEmail ? <div className="muted">{r.managerEmail}</div> : null}
                </td>
                <td>{r.userCount}</td>
                <td>{r.orderCount}</td>
                <td className="row-actions">
                  <button
                    className="btn tiny"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(r.id);
                      setForm({
                        name: r.name,
                        code: r.code,
                        city: r.city ?? '',
                        managerName: r.managerName ?? '',
                        managerEmail: r.managerEmail ?? '',
                      });
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    Edit
                  </button>
                  <button className="btn tiny danger" disabled={busy} onClick={() => deleter(r.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

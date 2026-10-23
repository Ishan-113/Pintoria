import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api/endpoints';
import { Card, ErrBanner, Field } from '../components/ui';

export function NewOrder() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '',
    itemName: '',
    specification: '',
    quantity: '',
    unit: 'pcs',
    requestedDeliveryDate: '',
    notes: '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createOrder({
        title: form.title.trim(),
        itemName: form.itemName.trim(),
        specification: form.specification.trim(),
        quantity: Number(form.quantity),
        unit: form.unit.trim(),
        requestedDeliveryDate: form.requestedDeliveryDate,
        notes: form.notes.trim() || undefined,
      });
      navigate(`/orders/${created.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <h2>New order</h2>
      <Card>
        <form onSubmit={submit}>
          <Field label="Order title" hint="How this job is referred to, e.g. “Diwali campaign cartons”">
            <input value={form.title} onChange={set('title')} required minLength={3} />
          </Field>
          <Field label="Item name">
            <input value={form.itemName} onChange={set('itemName')} required minLength={2} />
          </Field>
          <Field label="Specification" hint="Sizes, material, colours, finishes, print sides…">
            <textarea rows={4} value={form.specification} onChange={set('specification')} required minLength={5} />
          </Field>
          <div className="row">
            <Field label="Quantity">
              <input type="number" min="0.001" step="any" value={form.quantity} onChange={set('quantity')} required />
            </Field>
            <Field label="Unit">
              <input value={form.unit} onChange={set('unit')} required />
            </Field>
            <Field label="Requested delivery">
              <input type="date" value={form.requestedDeliveryDate} onChange={set('requestedDeliveryDate')} required />
            </Field>
          </div>
          <Field label="Notes (optional)">
            <textarea rows={2} value={form.notes} onChange={set('notes')} />
          </Field>
          <ErrBanner error={error} />
          <div className="modal-buttons">
            <button type="button" className="btn" onClick={() => navigate(-1)}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? 'Submitting…' : 'Submit for approval'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}

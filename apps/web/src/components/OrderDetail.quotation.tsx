import { useState } from 'react';
import * as api from '../api/endpoints';
import { useSession } from '../auth/session';
import { Banner, Empty, Field } from './ui';

type Run = (fn: () => Promise<unknown>) => Promise<void>;

interface ItemDraft {
  description: string;
  specification: string;
  quantity: string;
  unit: string;
  unitRate: string;
  taxRatePct: string;
}

const money = (n: number | null, currency: string) =>
  n === null ? '—' : `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

export function QuotationPanel({
  order,
  busy,
  run,
  onPromptRevision,
  onPromptReject,
}: {
  order: api.OrderDetail;
  busy: boolean;
  run: Run;
  onPromptRevision: () => void;
  onPromptReject: () => void;
}) {
  const { user } = useSession();
  const [editing, setEditing] = useState(false);

  const role = user?.role;
  const canSeePricing = !!role && (!role.startsWith('CLIENT_') || role === 'CLIENT_HEAD_OFFICE');
  const salesEditing =
    user?.permissions.includes('quotation.manage') === true &&
    ['QUOTATION_IN_PROGRESS', 'REVISION_REQUESTED'].includes(order.status);

  const draft = order.quotations.find((q) => q.status === 'DRAFT');
  const submitted = order.quotations.find((q) => q.status === 'SUBMITTED');

  if (order.quotations.length === 0 && !salesEditing) {
    return (
      <Empty>
        No quotations yet.
        {user?.role === 'CLIENT_REGIONAL' && ' Your head office will share commercial details once reviewed.'}
      </Empty>
    );
  }

  return (
    <div>
      {salesEditing && (
        <div className="sales-track">
          {draft ? (
            editing ? (
              <QuotationEditor
                quotation={draft}
                busy={busy}
                onCancel={() => setEditing(false)}
                onSave={(dto) => run(() => api.putQuotation(draft.id, dto)).then(() => setEditing(false))}
                onSubmit={() => run(() => api.submitQuotation(draft.id))}
              />
            ) : (
              <div>
                <Banner kind="info">
                  Draft quotation <strong>{draft.quotationRef}</strong> is open for editing.
                </Banner>
                <div className="row gap">
                  <button className="btn primary" disabled={busy} onClick={() => setEditing(true)}>
                    Edit draft quotation
                  </button>
                  <button
                    className="btn"
                    disabled={busy || draft.items.length === 0}
                    onClick={() => run(() => api.submitQuotation(draft.id))}
                  >
                    Submit to client
                  </button>
                </div>
              </div>
            )
          ) : (
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => run(() => api.postQuotationDraft(order.id))}
            >
              Create draft quotation
            </button>
          )}
        </div>
      )}

      {order.quotations
        .slice()
        .reverse()
        .map((q) => (
          <div key={q.id} className="quotation-card">
            <div className="row between">
              <strong>
                {q.quotationRef} · v{q.version}
              </strong>
              <span className={`tag ${q.status === 'APPROVED' ? 'green' : q.status === 'REJECTED' ? 'red' : 'amber'}`}>
                {q.status.replace(/_/g, ' ')}
              </span>
            </div>
            {q.items.length > 0 && (
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    {canSeePricing && <th>Rate</th>}
                    {canSeePricing && <th>Tax %</th>}
                    {canSeePricing && <th>Amount</th>}
                  </tr>
                </thead>
                <tbody>
                  {q.items.map((it) => (
                    <tr key={it.id}>
                      <td>
                        {it.description}
                        {it.specification ? <span className="muted"> — {it.specification}</span> : null}
                      </td>
                      <td>
                        {it.quantity} {it.unit}
                      </td>
                      {canSeePricing && <td>{it.unitRate}</td>}
                      {canSeePricing && <td>{it.taxRatePct}%</td>}
                      {canSeePricing && <td>{money(it.amount, q.currency)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {canSeePricing ? (
              <p className="muted">
                Subtotal {money(q.subTotal, q.currency)} · Tax {money(q.taxAmount, q.currency)} ·{' '}
                <strong>Total {money(q.totalAmount, q.currency)}</strong>
                {q.validityDate ? ` · valid till ${q.validityDate.slice(0, 10)}` : ''}
                {q.paymentTerms ? ` · payment: ${q.paymentTerms}` : ''}
              </p>
            ) : (
              <p className="muted">
                Commercial values hidden — kindly route approvals through your head office contact.
              </p>
            )}

            {q.status === 'SUBMITTED' && user?.permissions.includes('quotation.decide') && order.status === 'QUOTATION_SUBMITTED' && (
              <div className="row gap">
                <button className="btn primary" disabled={busy} onClick={() => run(() => api.postQuotationDecision(order.id, 'approve'))}>
                  Approve quotation
                </button>
                <button className="btn" disabled={busy} onClick={onPromptRevision}>
                  Request revision
                </button>
                <button className="btn danger" disabled={busy} onClick={onPromptReject}>
                  Reject
                </button>
              </div>
            )}
            {q.status === 'SUBMITTED' && user?.role === 'CLIENT_REGIONAL' && (
              <p className="muted">Awaiting head-office decision on this quotation.</p>
            )}
          </div>
        ))}

      {submitted && user?.role === 'CLIENT_HEAD_OFFICE' && order.status !== 'QUOTATION_SUBMITTED' && (
        <p className="muted">Decision recorded — see the stage timeline.</p>
      )}
      {!salesEditing && order.status === 'REVISION_REQUESTED' && (
        <Banner kind="info">Revision requested — Printoria sales is preparing an updated quotation.</Banner>
      )}
      {order.status === 'QUOTATION_SUBMITTED' && !submitted && (
        <p className="muted">Quotation submitted — awaiting your head office decision.</p>
      )}
    </div>
  );
}

function QuotationEditor({
  quotation,
  busy,
  onCancel,
  onSave,
  onSubmit,
}: {
  quotation: api.Quotation;
  busy: boolean;
  onCancel: () => void;
  onSave: (dto: Parameters<typeof api.putQuotation>[1]) => void;
  onSubmit: () => void;
}) {
  const [items, setItems] = useState<ItemDraft[]>(
    quotation.items.map((it) => ({
      description: it.description,
      specification: it.specification ?? '',
      quantity: String(it.quantity),
      unit: it.unit,
      unitRate: String(it.unitRate),
      taxRatePct: String(it.taxRatePct),
    })),
  );
  const [paymentTerms, setPaymentTerms] = useState(quotation.paymentTerms ?? '50% advance, balance on delivery');
  const [deliveryTerms, setDeliveryTerms] = useState(quotation.deliveryTerms ?? 'Ex-works, breakeven freight billed at actuals');
  const [validityDate, setValidityDate] = useState(quotation.validityDate?.slice(0, 10) ?? '');

  const setItem = (i: number, key: keyof ItemDraft, value: string) =>
    setItems((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  const buildDto = (): Parameters<typeof api.putQuotation>[1] | null => {
    const parsed = items.map((it) => ({
      description: it.description.trim(),
      specification: it.specification.trim() || undefined,
      quantity: Number(it.quantity),
      unit: it.unit.trim(),
      unitRate: Number(it.unitRate),
      taxRatePct: Number(it.taxRatePct),
    }));
    if (parsed.some((it) => !it.description || !Number.isFinite(it.quantity) || !Number.isFinite(it.unitRate) || !Number.isFinite(it.taxRatePct)))
      return null;
    return {
      items: parsed,
      paymentTerms: paymentTerms.trim() || undefined,
      deliveryTerms: deliveryTerms.trim() || undefined,
      validityDate: validityDate || undefined,
    };
  };

  return (
    <div className="editor">
      <table className="table compact">
        <thead>
          <tr>
            <th>Description</th>
            <th>Spec</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Rate</th>
            <th>Tax %</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td>
                <input value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} />
              </td>
              <td>
                <input value={it.specification ?? ''} onChange={(e) => setItem(i, 'specification', e.target.value)} />
              </td>
              <td>
                <input className="num" type="number" step="any" value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} />
              </td>
              <td>
                <input value={it.unit} onChange={(e) => setItem(i, 'unit', e.target.value)} />
              </td>
              <td>
                <input className="num" type="number" step="any" value={it.unitRate} onChange={(e) => setItem(i, 'unitRate', e.target.value)} />
              </td>
              <td>
                <input className="num" type="number" step="any" value={it.taxRatePct} onChange={(e) => setItem(i, 'taxRatePct', e.target.value)} />
              </td>
              <td>
                <button className="btn tiny" type="button" disabled={busy} onClick={() => setItems((rows) => rows.filter((_, idx) => idx !== i))}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn tiny" type="button" disabled={busy} onClick={() => setItems((rows) => [...rows, { description: '', specification: '', quantity: '1', unit: 'pcs', unitRate: '0', taxRatePct: '18' }])}>
        + Add line
      </button>
      <div className="row">
        <Field label="Payment terms">
          <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
        </Field>
        <Field label="Delivery terms">
          <input value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} />
        </Field>
        <Field label="Valid till">
          <input type="date" value={validityDate} onChange={(e) => setValidityDate(e.target.value)} />
        </Field>
      </div>
      <div className="modal-buttons">
        <button className="btn" onClick={onCancel} disabled={busy}>
          Close editor
        </button>
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => {
            const dto = buildDto();
            if (dto) onSave(dto);
          }}
        >
          {busy ? 'Saving…' : 'Save draft'}
        </button>
        <button
          className="btn"
          disabled={busy || items.length === 0}
          onClick={() => {
            const dto = buildDto();
            if (dto) {
              onSave(dto);
              onSubmit();
            }
          }}
        >
          Save &amp; submit to client
        </button>
      </div>
    </div>
  );
}

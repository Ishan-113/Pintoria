import { useState } from 'react';
import * as api from '../api/endpoints';
import { useSession } from '../auth/session';
import { Banner, Card, Empty, Field, ReasonPrompt } from './ui';

type Run = (fn: () => Promise<unknown>) => Promise<void>;

export function PoPanel({
  order,
  approvedQuotation,
  busy,
  run,
}: {
  order: api.OrderDetail;
  approvedQuotation?: api.Quotation;
  busy: boolean;
  run: Run;
}) {
  const { user } = useSession();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [overridePo, setOverridePo] = useState<api.PurchaseOrder | null>(null);
  const [queryPo, setQueryPo] = useState<api.PurchaseOrder | null>(null);

  const isRegional = user?.role === 'CLIENT_REGIONAL';
  const canUpload = user?.permissions.includes('po.upload') && order.status === 'AWAITING_PO';
  const canVerify = user?.permissions.includes('po.verify') && order.status === 'PO_RECEIVED';

  const pendingPo = order.purchaseOrders.find((po) => po.status === 'PENDING_VERIFICATION');
  const anyMismatch =
    pendingPo && pendingPo.checks.some((c) => c.matched === false) ? pendingPo : null;

  return (
    <div>
      {isRegional && (
        <Empty>
          Purchase order details are handled by your head office.
        </Empty>
      )}

      {canUpload && !uploadOpen && (
        <div>
          <Banner kind="info">
            Quotation approved — upload the signed purchase order to move this order into production.
          </Banner>
          <button className="btn primary" disabled={busy} onClick={() => setUploadOpen(true)}>
            Upload purchase order
          </button>
        </div>
      )}

      {canUpload && uploadOpen && (
        <PoUploadForm
          order={order}
          quotation={approvedQuotation}
          busy={busy}
          onClose={() => setUploadOpen(false)}
          onUpload={(dto) =>
            run(() => api.uploadPo(order.id, dto).then(() => setUploadOpen(false)))
          }
        />
      )}

      {order.purchaseOrders.map((po) => {
        const mismatches = po.checks.filter((c) => c.matched === false);
        return (
          <div key={po.id} className="po-card">
            <div className="row between">
              <strong>
                {po.poNumber}
                {po.checks.length > 0 && (
                  <span className={`tag ${mismatches.length === 0 ? 'green' : 'red'}`}>
                    verification: {po.checks.filter((c) => c.matched === true).length}/{po.checks.length} checks passed
                  </span>
                )}
              </strong>
              <span className={`tag ${po.status === 'CONFIRMED' ? 'green' : po.status === 'QUERY_RAISED' ? 'red' : 'amber'}`}>
                {po.status.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="muted">
              PO date {po.poDate.slice(0, 10)} · uploaded {new Date(po.uploadedAt).toLocaleString()}
              {po.expectedDeliveryDate ? ` · promised delivery ${po.expectedDeliveryDate.slice(0, 10)}` : ''}
              {user?.role !== 'CLIENT_REGIONAL' && po.poTotal !== null ? ` · PO amount ${po.poTotal}` : ''}
            </p>

            {po.checks.length > 0 && (
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Check</th>
                    <th>Expected</th>
                    <th>On PO</th>
                    <th>Result</th>
                    <th>Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {po.checks.map((c) => (
                    <tr key={c.key}>
                      <td>{c.label}</td>
                      <td>{c.expected ?? '—'}</td>
                      <td>{c.actual ?? '—'}</td>
                      <td>
                        {c.matched === null ? (
                          <span className="tag amber">n/a</span>
                        ) : c.matched ? (
                          <span className="tag green">match</span>
                        ) : (
                          <span className="tag red">mismatch</span>
                        )}
                      </td>
                      <td>{c.remark ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {canVerify && po.status === 'PENDING_VERIFICATION' && (
              <div className="row gap">
                {anyMismatch?.id === po.id ? (
                  <button className="btn" disabled={busy} onClick={() => setOverridePo(po)}>
                    Confirm with override remark
                  </button>
                ) : (
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() => run(() => api.poDecision(order.id, po.id, { action: 'confirm' }))}
                  >
                    Confirm PO → order ready for production
                  </button>
                )}
                <button className="btn" disabled={busy} onClick={() => setQueryPo(po)}>
                  Raise query to client
                </button>
              </div>
            )}
            {po.status === 'QUERY_RAISED' && !isRegional && (
              <p className="muted">A query was raised — waiting for the client to upload a corrected PO.</p>
            )}
          </div>
        );
      })}

      {order.purchaseOrders.length === 0 && !canUpload && !isRegional && (
        <Empty>No purchase orders uploaded yet.</Empty>
      )}

      {overridePo && (
        <ReasonPrompt
          title={`Override mismatches on ${overridePo.poNumber}`}
          description="The PO failed one or more automated checks above. Confirming with an override requires a written justification — this is recorded on the audit trail."
          actionLabel="Confirm PO (override)"
          busy={busy}
          onCancel={() => setOverridePo(null)}
          onConfirm={(reason) => {
            if (!reason) return;
            run(() => api.poDecision(order.id, overridePo.id, { action: 'confirm', overrideRemark: reason }));
          }}
        />
      )}
      {queryPo && (
        <ReasonPrompt
          title={`Raise a query on ${queryPo.poNumber}`}
          description="The order goes back to the client to upload a corrected purchase order."
          actionLabel="Raise query"
          busy={busy}
          onCancel={() => setQueryPo(null)}
          onConfirm={(reason) => {
            if (!reason) return;
            run(() => api.poDecision(order.id, queryPo.id, { action: 'raise_query', reason }));
          }}
        />
      )}
    </div>
  );
}

function PoUploadForm({
  order,
  quotation,
  busy,
  onClose,
  onUpload,
}: {
  order: api.OrderDetail;
  quotation?: api.Quotation;
  busy: boolean;
  onClose: () => void;
  onUpload: (dto: api.UploadPoInput) => void;
}) {
  const [form, setForm] = useState({
    poNumber: `PO-${order.orderNumber}`,
    poDate: new Date().toISOString().slice(0, 10),
    poTotal: quotation?.totalAmount != null ? String(quotation.totalAmount) : '',
    taxTotal: quotation?.taxAmount != null ? String(quotation.taxAmount) : '',
    paymentTerms: quotation?.paymentTerms ?? '',
    expectedDeliveryDate: '',
    poItems:
      quotation && quotation.items.length > 0
        ? quotation.items.map((it) => ({
            description: it.description,
            quantity: String(it.quantity),
            unit: it.unit,
            unitRate: it.unitRate != null ? String(it.unitRate) : '',
          }))
        : [{ description: '', quantity: '', unit: '', unitRate: '' }],
  });
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (i: number, key: string, v: string) =>
    setForm((f) => ({
      ...f,
      poItems: f.poItems.map((it, idx) => (idx === i ? { ...it, [key]: v } : it)),
    }));

  const submit = () => {
    const parsed = form.poItems.map((it) => ({
      description: it.description.trim(),
      quantity: Number(it.quantity),
      unit: it.unit.trim() || undefined,
      unitRate: it.unitRate ? Number(it.unitRate) : undefined,
    }));
    if (parsed.some((it) => !it.description || !Number.isFinite(it.quantity))) {
      setErr('Every PO line needs a description and a numeric quantity.');
      return;
    }
    const poTotal = Number(form.poTotal);
    if (!form.poNumber.trim() || !form.poDate || !Number.isFinite(poTotal)) {
      setErr('PO number, date and total are required.');
      return;
    }
    onUpload({
      poNumber: form.poNumber.trim(),
      poDate: form.poDate,
      poItems: parsed,
      poTotal,
      taxTotal: form.taxTotal ? Number(form.taxTotal) : undefined,
      paymentTerms: form.paymentTerms.trim() || undefined,
      expectedDeliveryDate: form.expectedDeliveryDate || undefined,
    });
  };

  return (
    <Card title={`Upload purchase order for ${order.orderNumber}`}>
      <div className="row">
        <Field label="PO number">
          <input value={form.poNumber} onChange={(e) => set('poNumber', e.target.value)} required />
        </Field>
        <Field label="PO date">
          <input type="date" value={form.poDate} onChange={(e) => set('poDate', e.target.value)} required />
        </Field>
        <Field label="PO total" hint="A 0.5% tolerance is applied automatically.">
          <input type="number" step="any" value={form.poTotal} onChange={(e) => set('poTotal', e.target.value)} required />
        </Field>
        <Field label="Tax total">
          <input type="number" step="any" value={form.taxTotal} onChange={(e) => set('taxTotal', e.target.value)} />
        </Field>
      </div>
      <div className="row">
        <Field label="Payment terms">
          <input value={form.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} />
        </Field>
        <Field label="Expected delivery">
          <input type="date" value={form.expectedDeliveryDate} onChange={(e) => set('expectedDeliveryDate', e.target.value)} />
        </Field>
      </div>
      <table className="table compact">
        <thead>
          <tr>
            <th>Description</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Rate</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {form.poItems.map((it, i) => (
            <tr key={i}>
              <td>
                <input value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} />
              </td>
              <td>
                <input type="number" step="any" value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} />
              </td>
              <td>
                <input value={it.unit ?? ''} onChange={(e) => setItem(i, 'unit', e.target.value)} />
              </td>
              <td>
                <input type="number" step="any" value={it.unitRate ?? ''} onChange={(e) => setItem(i, 'unitRate', e.target.value)} />
              </td>
              <td>
                <button
                  className="btn tiny"
                  type="button"
                  onClick={() =>
                    setForm((f) => ({ ...f, poItems: f.poItems.filter((_, idx) => idx !== i) }))
                  }
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="btn tiny"
        type="button"
        onClick={() =>
          setForm((f) => ({ ...f, poItems: [...f.poItems, { description: '', quantity: '', unit: '', unitRate: '' }] }))
        }
      >
        + Add PO line
      </button>
      {err && <Banner kind="error">{err}</Banner>}
      <div className="modal-buttons">
        <button className="btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={submit}>
          {busy ? 'Uploading…' : 'Upload PO'}
        </button>
      </div>
    </Card>
  );
}

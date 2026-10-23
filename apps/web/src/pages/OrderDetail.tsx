import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ORDER_STATUS_LABELS, ORDER_STATUSES } from '@pintoria/shared';
import type { OrderStatus } from '@pintoria/shared';
import * as api from '../api/endpoints';
import { useSession } from '../auth/session';
import { Banner, Card, Empty, ErrBanner, ErrorText, Field, ReasonPrompt, StatusChip } from '../components/ui';
import { QuotationPanel } from '../components/OrderDetail.quotation';
import { PoPanel } from '../components/OrderDetail.po';
import { FilesPanel } from '../components/OrderDetail.files';

const TERMINAL: OrderStatus[] = ['REJECTED', 'CANCELLED', 'DELIVERED_CLOSED'];
const idx = (s: OrderStatus) => ORDER_STATUSES.indexOf(s);

type Prompt =
  | { kind: 'reason'; title: string; onConfirm: (reason: string) => void }
  | { kind: 'dispatch' };

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const { user } = useSession();
  const [order, setOrder] = useState<api.OrderDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [audit, setAudit] = useState<api.AuditResponse | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [resubmit, setResubmit] = useState(false);

  const role = user?.role;
  const isClient = role?.startsWith('CLIENT_') ?? false;

  const load = useCallback(() => {
    api.getOrder(id).then(setOrder).catch(setError);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const reload = async () => {
    setOrder(null);
    load();
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await api.getOrder(id).then(setOrder);
      setPrompt(null);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  const canCancel = useMemo((): boolean => {
    if (!order || !user || TERMINAL.includes(order.status)) return false;
    const i = idx(order.status);
    if (user.role === 'CLIENT_REGIONAL') return i <= idx('RETURNED_FOR_CLARIFICATION');
    if (user.role === 'CLIENT_HEAD_OFFICE') return i <= idx('PO_RECEIVED');
    if (user.role === 'PRINTORIA_ADMIN') return i <= idx('DISPATCHED');
    if (user.role === 'PRINTORIA_OPS') return i <= idx('QUALITY_CHECK');
    return false;
  }, [order, user]);
  const latestRequirement = order?.requirementVersions[0];
  const approvedQuotation = order?.quotations.find((q) => q.status === 'APPROVED');

  if (error) return <ErrorText error={error} />;
  if (!order) return <p className="muted">Loading order…</p>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>
            {order.orderNumber} — {order.title}
          </h2>
          <p className="muted">
            {order.client.name} · {order.region.name} · raised by {order.createdBy.fullName} ·
            delivered by {order.requestedDeliveryDate?.slice(0, 10) ?? '—'}
          </p>
        </div>
        <div className="row gap">
          <StatusChip status={order.status} />
          {role === 'PRINTORIA_ADMIN' && (
            <button className="btn" onClick={() => (showAudit ? setShowAudit(false) : void loadAudit())}>
              {showAudit ? 'Hide audit' : 'Audit trail'}
            </button>
          )}
          {canCancel && (
            <button
              className="btn danger"
              disabled={busy}
              onClick={() =>
                setPrompt({
                  kind: 'reason',
                  title: 'Cancel this order?',
                  onConfirm: (reason) =>
                    run(() => api.postTransition(order.id, { action: 'cancel_order', reason })),
                })
              }
            >
              Cancel order
            </button>
          )}
        </div>
      </div>

      <ErrBanner error={actionError} />
      {order.statusLogs
        .filter((l) => l.toStatus === 'CANCELLED')
        .slice(-1)
        .map((cl) => (
          <Banner key={cl.id} kind="info">
            Cancelled by {cl.actorRole} on {new Date(cl.createdAt).toLocaleString()} — “
            {cl.reason ?? 'no reason recorded'}”
          </Banner>
        ))}

      {prompt?.kind === 'reason' && (
        <ReasonPrompt
          title={prompt.title}
          actionLabel="Confirm"
          busy={busy}
          onCancel={() => setPrompt(null)}
          onConfirm={(reason) => {
            if (reason === undefined) return; // server would 422 anyway
            prompt.onConfirm(reason);
          }}
        />
      )}
      {prompt?.kind === 'dispatch' && (
        <DispatchPrompt
          busy={busy}
          onCancel={() => setPrompt(null)}
          onConfirm={(transporter, awb) =>
            run(() =>
              api.postTransition(order.id, { action: 'dispatch', payload: { transporter, awb } }),
            )
          }
        />
      )}

      <div className="grid-2">
        <Card title="Requirement (latest version first)">
          {order.requirementVersions.map((rv) => (
            <div key={rv.id} className="version-card">
              <div className="row between">
                <strong>Version {rv.version}</strong>
                <span className="muted">{new Date(rv.submittedAt).toLocaleString()}</span>
              </div>
              <p>
                <strong>{rv.itemName}</strong> — {rv.quantity} {rv.unit}
              </p>
              <p className="spec">{rv.specification}</p>
              <p className="muted">Requested delivery: {rv.requestedDeliveryDate.slice(0, 10)}</p>
              {rv.notes && <p className="muted">Notes: {rv.notes}</p>}
            </div>
          ))}

          {user?.permissions.includes('requirement.update') &&
            order.status === 'RETURNED_FOR_CLARIFICATION' &&
            (resubmit ? (
              <ResubmitForm
                initial={latestRequirement}
                busy={busy}
                onCancel={() => setResubmit(false)}
                onSubmit={(dto) => run(() => api.postRequirementVersion(order.id, dto).then(reload))}
              />
            ) : (
              <button className="btn primary" onClick={() => setResubmit(true)}>
                Revise &amp; resubmit requirement
              </button>
            ))}
          {user?.permissions.includes('requirement.decide') && order.status === 'SUBMITTED' && (
            <div className="row gap">
              <button className="btn primary" disabled={busy} onClick={() => run(() => api.postRequirementDecision(order.id, 'approve'))}>
                Approve requirement
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  setPrompt({
                    kind: 'reason',
                    title: 'Return for clarification',
                    onConfirm: (reason) => run(() => api.postRequirementDecision(order.id, 'return', reason)),
                  })
                }
              >
                Return for clarification
              </button>
              <button
                className="btn danger"
                disabled={busy}
                onClick={() =>
                  setPrompt({
                    kind: 'reason',
                    title: 'Reject requirement',
                    onConfirm: (reason) => run(() => api.postRequirementDecision(order.id, 'reject', reason)),
                  })
                }
              >
                Reject
              </button>
            </div>
          )}
        </Card>

        <Card title="Stage timeline">
          {order.statusLogs.length === 0 && <Empty>No activity yet.</Empty>}
          <ol className="timeline">
            {order.statusLogs.map((l) => (
              <li key={l.id}>
                <div>
                  <strong>{ORDER_STATUS_LABELS[l.toStatus]}</strong>{' '}
                  <span className="muted">
                    via {l.action} · {l.actorRole} · {new Date(l.createdAt).toLocaleString()}
                  </span>
                </div>
                {l.reason && <div className="tag red">reason: {l.reason}</div>}
                {l.comment && <div className="muted">{l.comment}</div>}
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Card title="Quotations">
        <QuotationPanel
          order={order}
          busy={busy}
          run={run}
          onPromptRevision={() =>
            setPrompt({
              kind: 'reason',
              title: 'Request a quotation revision',
              onConfirm: (reason) => run(() => api.postQuotationDecision(order.id, 'request_revision', reason)),
            })
          }
          onPromptReject={() =>
            setPrompt({
              kind: 'reason',
              title: 'Reject quotation',
              onConfirm: (reason) => run(() => api.postQuotationDecision(order.id, 'reject', reason)),
            })
          }
        />
      </Card>

      <Card title="Purchase order &amp; verification">
        <PoPanel
          order={order}
          approvedQuotation={approvedQuotation ?? undefined}
          busy={busy}
          run={run}
        />
      </Card>

      <Card title="Documents">
        <FilesPanel order={order} />
      </Card>

      {!!user?.permissions.includes('fulfilment.advance') && (
        <Card title="Fulfilment">
          <div className="row gap">
            {order.status === 'ORDER_CONFIRMED' && (
              <button className="btn primary" disabled={busy} onClick={() => run(() => api.postTransition(order.id, { action: 'start_production' }))}>
                Start production
              </button>
            )}
            {order.status === 'IN_PRODUCTION' && (
              <button className="btn primary" disabled={busy} onClick={() => run(() => api.postTransition(order.id, { action: 'start_qc' }))}>
                Send to quality check
              </button>
            )}
            {order.status === 'QUALITY_CHECK' && (
              <button className="btn primary" disabled={busy} onClick={() => setPrompt({ kind: 'dispatch' })}>
                Dispatch…
              </button>
            )}
            {order.status === 'DISPATCHED' && (
              <button className="btn primary" disabled={busy} onClick={() => run(() => api.postTransition(order.id, { action: 'mark_delivered' }))}>
                Mark delivered &amp; close
              </button>
            )}
            {!['ORDER_CONFIRMED', 'IN_PRODUCTION', 'QUALITY_CHECK', 'DISPATCHED'].includes(order.status) && (
              <Empty>Fulfilment actions appear once the order is confirmed.</Empty>
            )}
          </div>
        </Card>
      )}

      {showAudit && audit && (
        <Card title="Audit trail (system of record)">
          <p className="muted">{audit.auditRecords.length} audit records</p>
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              {audit.auditRecords.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td>{r.actor?.fullName ?? '—'}</td>
                  <td>{r.action}</td>
                  <td>
                    <pre className="json">{JSON.stringify(r.after ?? {}, null, 2)}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {isClient && (
        <p className="muted">
          Lost? Return to <Link to="/orders">all orders</Link>.
        </p>
      )}
    </div>
  );

  async function loadAudit() {
    try {
      const a = await api.orderAudit(order!.id);
      setAudit(a);
      setShowAudit(true);
    } catch (err) {
      setActionError(err);
    }
  }
}

function DispatchPrompt({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (transporter: string, awb: string) => void;
}) {
  const [transporter, setTransporter] = useState('');
  const [awb, setAwb] = useState('');
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Dispatch the order</h3>
        <Field label="Transporter">
          <input value={transporter} onChange={(e) => setTransporter(e.target.value)} placeholder="BlueDart / Delhivery / …" />
        </Field>
        <Field label="AWB / consignment no.">
          <input value={awb} onChange={(e) => setAwb(e.target.value)} />
        </Field>
        <div className="modal-buttons">
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !transporter.trim() || !awb.trim()} onClick={() => onConfirm(transporter.trim(), awb.trim())}>
            {busy ? 'Dispatching…' : 'Dispatch'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResubmitForm({
  initial,
  busy,
  onCancel,
  onSubmit,
}: {
  initial?: api.RequirementVersion;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (dto: {
    itemName: string;
    specification: string;
    quantity: number;
    unit: string;
    requestedDeliveryDate: string;
    notes?: string;
  }) => void;
}) {
  const t = initial;
  const [form, setForm] = useState({
    itemName: t?.itemName ?? '',
    specification: t?.specification ?? '',
    quantity: t?.quantity?.toString() ?? '',
    unit: t?.unit ?? 'pcs',
    requestedDeliveryDate: t?.requestedDeliveryDate?.slice(0, 10) ?? '',
    notes: t?.notes ?? '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          itemName: form.itemName.trim(),
          specification: form.specification.trim(),
          quantity: Number(form.quantity),
          unit: form.unit.trim(),
          requestedDeliveryDate: form.requestedDeliveryDate,
          notes: form.notes.trim() || undefined,
        });
      }}
    >
      <Field label="Item name">
        <input value={form.itemName} onChange={set('itemName')} required />
      </Field>
      <Field label="Specification">
        <textarea rows={4} value={form.specification} onChange={set('specification')} required />
      </Field>
      <div className="row">
        <Field label="Quantity">
          <input type="number" step="any" value={form.quantity} onChange={set('quantity')} required />
        </Field>
        <Field label="Unit">
          <input value={form.unit} onChange={set('unit')} required />
        </Field>
        <Field label="Requested delivery">
          <input type="date" value={form.requestedDeliveryDate} onChange={set('requestedDeliveryDate')} required />
        </Field>
      </div>
      <Field label="Notes">
        <input value={form.notes} onChange={set('notes')} />
      </Field>
      <div className="modal-buttons">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy}>
          {busy ? 'Submitting…' : 'Resubmit requirement'}
        </button>
      </div>
    </form>
  );
}

import type { ReactNode } from 'react';
import { ORDER_STATUS_LABELS } from '@pintoria/shared';
import type { OrderStatus } from '@pintoria/shared';

export function StatusChip({ status }: { status: OrderStatus }) {
  return <span className={`chip chip-${status.toLowerCase()}`}>{ORDER_STATUS_LABELS[status]}</span>;
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Banner({ kind, children }: { kind: 'error' | 'info' | 'ok'; children: ReactNode }) {
  return <div className={`banner banner-${kind}`}>{children}</div>;
}

/** Modal that asks for a mandatory reason (and optional note). */
export function ReasonPrompt({
  title,
  description,
  requireReason = true,
  actionLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description?: string;
  requireReason?: boolean;
  actionLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string | undefined) => void;
}) {
  let reason = '';
  const submit = () => {
    onConfirm(requireReason && !reason.trim() ? undefined : reason.trim());
  };
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {description && <p className="muted">{description}</p>}
        {requireReason && (
          <Field label="Reason (required)">
            <textarea
              autoFocus
              rows={3}
              onChange={(e) => (reason = e.target.value)}
              placeholder="Why is this happening?"
            />
          </Field>
        )}
        <div className="modal-buttons">
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? 'Working…' : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as { code?: string; message?: string; details?: unknown };
  return (
    <div className="field-error">
      {e.message ?? String(error)}
      {e.details ? <pre>{JSON.stringify(e.details, null, 2)}</pre> : null}
    </div>
  );
}

export function ErrBanner({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="banner banner-error">
      <ErrorText error={error} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty muted">{children}</p>;
}

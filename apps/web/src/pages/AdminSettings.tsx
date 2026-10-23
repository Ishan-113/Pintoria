import { useEffect, useState } from 'react';
import * as api from '../api/endpoints';
import { Banner, ErrorText, Field } from '../components/ui';

const HINTS: Record<string, string> = {
  'uploads.maxFileMb': 'Maximum upload size for PO/quotation artifacts, in megabytes.',
  'fulfilment.visibility': 'JSON config controlling which fulfilment stages clients can see.',
  'notifications.email': 'Master switch for email alerts (per-client preferences still apply).',
  'notifications.whatsapp': 'WhatsApp delivery is parked until the gateway is wired up.',
  'cancellation.regionalMayCancel': 'Whether regional users may cancel orders before billing, true/false.',
  'cancellation.chargesApply': 'Whether cancellation after quotation approval triggers charges, true/false.',
  'alerts.stageThresholds': 'JSON map of stage → hours before the stage is flagged as delayed.',
};

export function AdminSettings() {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [keyError, setKeyError] = useState<Record<string, string>>({});

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        const initial: Record<string, string> = {};
        for (const [k, v] of Object.entries(s)) initial[k] = JSON.stringify(v, null, 2);
        setDrafts(initial);
      })
      .catch(setError);
  }, []);

  if (error) return <ErrorText error={error} />;
  if (!settings) return <p className="muted">Loading settings…</p>;

  const save = async (key: string) => {
    setBusy(true);
    setNotice('');
    setKeyError((e) => ({ ...e, [key]: '' }));
    let value: unknown;
    try {
      value = JSON.parse(drafts[key]);
    } catch {
      setKeyError((e) => ({ ...e, [key]: 'Value must be valid JSON.' }));
      setBusy(false);
      return;
    }
    try {
      const updated = await api.updateSetting(key, value);
      setSettings(updated);
      setDrafts((d) => ({ ...d, [key]: JSON.stringify(value, null, 2) }));
      setNotice(`Saved “${key}”.`);
    } catch (err) {
      setKeyError((e) => ({ ...e, [key]: (err as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const reset = (key: string) =>
    setDrafts((d) => ({ ...d, [key]: JSON.stringify(settings[key], null, 2) }));

  return (
    <div className="page narrow">
      <h2>Platform settings</h2>
      {notice && <Banner kind="ok">{notice}</Banner>}
      <p className="muted">
        Every value is stored in the database and takes effect immediately — no redeploy needed. Edits are
        recorded on the audit trail.
      </p>

      {Object.entries(settings).map(([key]) => (
        <section className="card" key={key}>
          <header className="card-head">
            <h3>
              <code>{key}</code>
            </h3>
          </header>
          <p className="muted">{HINTS[key] ?? 'Raw JSON value.'}</p>
          <Field label="Value (JSON)">
            <textarea
              rows={key === 'alerts.stageThresholds' || key === 'fulfilment.visibility' ? 8 : 3}
              value={drafts[key] ?? ''}
              onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
              spellCheck={false}
            />
          </Field>
          {keyError[key] && <Banner kind="error">{keyError[key]}</Banner>}
          <div className="modal-buttons">
            <button className="btn" disabled={busy} onClick={() => reset(key)}>
              Discard edits
            </button>
            <button className="btn primary" disabled={busy} onClick={() => save(key)}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}

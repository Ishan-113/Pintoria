import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../api/endpoints';
import { useSession } from '../auth/session';
import { Banner, Card, Empty, ErrorText } from '../components/ui';

export function Notifications() {
  const { user } = useSession();
  const [rows, setRows] = useState<api.NotificationRow[] | null>(null);
  const [prefs, setPrefs] = useState<Awaited<ReturnType<typeof api.getPrefs>> | null>(null);
  const [prefsEditable, setPrefsEditable] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [remRunning, setRemRunning] = useState(false);
  const [remNotice, setRemNotice] = useState('');

  const runReminders = async () => {
    setRemRunning(true);
    setError(null);
    try {
      const r = await api.runRemindersNow();
      setRemNotice(`Reminder run done: ${r.digestsSent} digest(s), ${r.remindersSent} overdue nudge(s).`);
      api
        .listMyNotifications()
        .then(setRows)
        .catch(() => undefined);
    } catch (err) {
      setError(err);
    } finally {
      setRemRunning(false);
    }
  };

  useEffect(() => {
    api
      .listMyNotifications()
      .then(setRows)
      .catch(setError);
    api
      .getPrefs()
      .then((p) => {
        setPrefs(p);
        // only users the server lets edit prefs get the toggles (server re-checks on PUT anyway)
        setPrefsEditable(true);
      })
      .catch(() => setPrefsEditable(false));
  }, []);

  const toggle = async (key: 'emailAlerts' | 'whatsappAlerts' | 'dailyPendingReminder', value: boolean) => {
    setBusy(true);
    setNotice('');
    setPrefsEditable(true);
    try {
      const updated = await api.updatePrefs({ [key]: value });
      setPrefs(updated);
      setNotice('Preferences saved.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorText error={error} />;

  return (
    <div className="page">
      <h2>Alerts</h2>

      {prefs && (
        <Card title="Email preferences">
          {notice && <Banner kind="ok">{notice}</Banner>}
          <div className="prefs">
            <PrefRow
              label="Email alerts"
              help="Order updates for orders you are involved with. Critical stage changes are always emailed, even if this is off."
              value={prefs.emailAlerts}
              editable={prefsEditable}
              busy={busy}
              onChange={(v) => toggle('emailAlerts', v)}
            />
            <PrefRow
              label="WhatsApp alerts"
              help="Workflow alerts as chat messages too. Runs on the built-in mock gateway — rows show SENT below once delivered."
              value={prefs.whatsappAlerts}
              editable={prefsEditable}
              busy={busy}
              onChange={(v) => toggle('whatsappAlerts', v)}
            />
            <PrefRow
              label="Daily pending-reminder digest"
              help="One summary each morning of work waiting on you."
              value={prefs.dailyPendingReminder}
              editable={prefsEditable}
              busy={busy}
              onChange={(v) => toggle('dailyPendingReminder', v)}
            />
          </div>
          {!prefsEditable && (
            <p className="muted">
              Preferences are managed at client level for your account. Ask your admin to change them.
            </p>
          )}
        </Card>
      )}

      <Card title="Recent alerts">
        {rows === null ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <Empty>No alerts yet — you will see order updates here as they happen.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Order</th>
                <th>Alert</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => {
                const label = n.templateKey.replace(/[._-]/g, ' ');
                const d = new Date(n.queuedAt);
                const stale = Date.now() - d.getTime() > 5 * 60 * 1000;
                return (
                  <tr key={n.id}>
                    <td>{d.toLocaleString()}</td>
                    <td>
                      {n.order?.orderNumber ? (
                        <Link to="/orders">{n.order.orderNumber}</Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {label}
                      {n.subject ? <div className="muted">{n.subject}</div> : null}
                    </td>
                    <td>
                      <span
                        className={`tag ${n.status === 'SENT' ? 'green' : n.status === 'FAILED' ? 'red' : 'amber'}`}
                        title={
                          n.status === 'PENDING' && stale
                            ? 'Queued — the dev inbox only flushes when the API sends.'
                            : undefined
                        }
                      >
                        {n.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {user?.role === 'PRINTORIA_ADMIN' && (
        <Card title="Reminder engine">
          <p className="muted">
            Admins are excluded from routine order emails — they audit rather than act. The engine
            also runs on schedule (daily digest at 03:00, overdue scan every 2 hours).
          </p>
          <button type="button" className="btn" disabled={remRunning} onClick={runReminders}>
            {remRunning ? 'Running…' : 'Run reminders now'}
          </button>
          {remNotice && <Banner kind="ok">{remNotice}</Banner>}
          <p className="muted">Your own feed below shows the alerts you receive; admins audit via the order page's full feed.</p>
        </Card>
      )}
    </div>
  );
}

function PrefRow({
  label,
  help,
  value,
  editable,
  busy,
  onChange,
}: {
  label: string;
  help: string;
  value: boolean;
  editable: boolean;
  busy: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="pref-row">
      <div>
        <strong>{label}</strong>
        <div className="muted">{help}</div>
      </div>
      <label className="switch">
        <input type="checkbox" checked={value} disabled={!editable || busy} onChange={(e) => onChange(e.target.checked)} />
        <span>{value ? 'On' : 'Off'}</span>
      </label>
    </div>
  );
}

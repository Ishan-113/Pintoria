import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { Banner, Field } from '../components/ui';

export function Login() {
  const { user, ready, login } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (ready && user) return <Navigate to="/dashboard" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
      navigate('/dashboard');
    } catch (err) {
      const e2 = err as { message?: string; logout?: boolean };
      setError(
        e2.logout
          ? 'Session expired. Please log in again.'
          : e2.message ?? 'Login failed. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand big">
          Printoria<span>Portal</span>
        </div>
        <p className="muted">B2B print &amp; packaging order workflow</p>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.example"
            required
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {error && <Banner kind="error">{error}</Banner>}
        <button className="btn primary full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

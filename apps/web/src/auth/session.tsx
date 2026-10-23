import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { clearTokens, storeTokens } from '../api/client';
import * as api from '../api/endpoints';
import type { SessionUser } from '../api/endpoints';

interface SessionState {
  user: SessionUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionState>({
  user: null,
  ready: false,
  login: async () => undefined,
  logout: async () => undefined,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  // restore the session on first paint if a token is present
  useEffect(() => {
    const hasToken = localStorage.getItem('pt.access');
    if (!hasToken) {
      setReady(true);
      return;
    }
    api
      .me()
      .then((u) => setUser(u))
      .catch(() => clearTokens())
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    storeTokens(res.accessToken, res.refreshToken);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    const refresh = localStorage.getItem('pt.refresh');
    if (refresh) await api.logout(refresh).catch(() => undefined);
    clearTokens();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, logout }),
    [user, ready, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  return useContext(Ctx);
}

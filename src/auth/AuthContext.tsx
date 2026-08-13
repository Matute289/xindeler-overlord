import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { ApiError, createApiClient } from '@/api';
import { useEnvironment } from '@/config/EnvironmentContext';

import { sessionStorage } from './sessionStorage';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

type AuthContextValue = {
  status: AuthStatus;
  operator: string | null;
  login: (username: string, password: string) => Promise<{ challengeId: string }>;
  totp: (challengeId: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  handleAuthError: (error: unknown) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { environment } = useEnvironment();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [operator, setOperator] = useState<string | null>(null);

  const api = useMemo(() => createApiClient(environment.baseUrl), [environment.baseUrl]);

  useEffect(() => {
    let cancelled = false;
    sessionStorage
      .read()
      .then(async (stored) => {
        if (cancelled) return;
        if (stored && new Date(stored.expiresAt).getTime() > Date.now()) {
          setOperator(stored.operator);
          setStatus('authenticated');
          return;
        }
        if (stored) {
          await sessionStorage.clear();
        }
        if (cancelled) return;
        setStatus('unauthenticated');
      })
      .catch(() => {
        if (!cancelled) setStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
    // Intentionally re-runs only on mount — an environment switch mid-session doesn't need to
    // re-read local storage, it's the same device regardless of which gateway it's pointed at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const result = await api.auth.login(username, password);
      return { challengeId: result.challenge_id };
    },
    [api]
  );

  const totp = useCallback(
    async (challengeId: string, code: string) => {
      const session = await api.auth.totp(challengeId, code);
      await sessionStorage.save({
        token: session.token,
        operator: session.operator,
        expiresAt: session.expires_at,
      });
      setOperator(session.operator);
      setStatus('authenticated');
    },
    [api]
  );

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // Best-effort — logging out locally must not get stuck waiting on a network call
      // that may never succeed (the gateway could already be unreachable).
    }
    await sessionStorage.clear();
    setOperator(null);
    setStatus('unauthenticated');
  }, [api]);

  const handleAuthError = useCallback((error: unknown): boolean => {
    if (error instanceof ApiError && (error.code === 'session_expired' || error.code === 'unauthorized')) {
      sessionStorage.clear().catch(() => {});
      setOperator(null);
      setStatus('unauthenticated');
      return true;
    }
    return false;
  }, []);

  const value = useMemo(
    () => ({ status, operator, login, totp, logout, handleAuthError }),
    [status, operator, login, totp, logout, handleAuthError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return value;
}

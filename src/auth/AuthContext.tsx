import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ApiError, createApiClient } from '@/api';
import { useEnvironment } from '@/config/EnvironmentContext';

import { sessionStorage } from './sessionStorage';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

type AuthContextValue = {
  status: AuthStatus;
  operator: string | null;
  operatorUuid: string | null;
  isSuperuser: boolean;
  // Whether beginLogin() has stashed credentials awaiting completeLogin() — the TOTP screen's
  // own guard against being reached with nothing pending (deep link, back/forward on web),
  // replacing the old challengeId route-param check. Deliberately a boolean, not the raw
  // username/password themselves — nothing outside this provider ever reads those directly.
  hasPendingLogin: boolean;
  // Synchronous, no network — stores username/password in-memory only (never sessionStorage,
  // never a route param) for completeLogin() to use once the operator enters their TOTP code.
  // A password must never transit through anything URL-shaped (OC-55 design doc).
  beginLogin: (username: string, password: string) => void;
  // Fires the one real request the real gateway actually expects (username + password + TOTP
  // together). On failure, does NOT clear the pending credentials — a wrong code should only
  // need retyping the code, not the whole form again.
  completeLogin: (totpCode: string) => Promise<void>;
  logout: () => Promise<void>;
  // Clearing the session here only resets auth *state* (status/operator/sessionStorage) —
  // it does not cancel any in-flight requests still carrying the now-invalid token/cookie.
  // Screens with their own data fetches are responsible for their own request cancellation
  // on unmount (e.g. an AbortController cleaned up in a useEffect); handleAuthError doesn't
  // reach into request lifecycle.
  handleAuthError: (error: unknown) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { environment } = useEnvironment();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [operator, setOperator] = useState<string | null>(null);
  const [operatorUuid, setOperatorUuid] = useState<string | null>(null);
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [hasPendingLogin, setHasPendingLogin] = useState(false);
  const pendingCredentials = useRef<{ username: string; password: string } | null>(null);

  const api = useMemo(() => createApiClient(environment.baseUrl), [environment.baseUrl]);

  useEffect(() => {
    let cancelled = false;
    sessionStorage
      .read()
      .then((stored) => {
        if (cancelled) return;
        // No server-communicated expiry to check locally (the real gateway's login response
        // has no `expires_at` — OC-55) — a persisted session record is treated as optimistically
        // authenticated; the first real request that actually fails (session_expired/
        // unauthorized) demotes via handleAuthError below, same as it already does today.
        if (stored) {
          setOperator(stored.operatorUsername);
          setOperatorUuid(stored.operatorUuid);
          setIsSuperuser(stored.isSuperuser);
          setStatus('authenticated');
          return;
        }
        setStatus('unauthenticated');
      })
      .catch(() => {
        if (!cancelled) setStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
    // Intentionally mount-only ([]): this restores whatever session was persisted from a
    // previous run of the app. A live environment switch while already running is handled
    // by the separate effect below, not by re-running this one.
  }, []);

  // A session token/cookie issued by one gateway is meaningless against another — switching
  // environments mid-session must drop back to unauthenticated rather than keep showing
  // (tabs) against a gateway that will reject every request. Skip the very first render:
  // that's the boot-time environment value, already handled by the read-on-mount effect
  // above, not a genuine switch.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    sessionStorage.clear().catch(() => {});
    setOperator(null);
    setOperatorUuid(null);
    setIsSuperuser(false);
    setStatus('unauthenticated');
  }, [environment.baseUrl]);

  const beginLogin = useCallback((username: string, password: string) => {
    pendingCredentials.current = { username, password };
    setHasPendingLogin(true);
  }, []);

  const completeLogin = useCallback(
    async (totpCode: string) => {
      const pending = pendingCredentials.current;
      if (!pending) {
        throw new Error('completeLogin called with no pending credentials');
      }
      const result = await api.auth.login(pending.username, pending.password, totpCode);
      await sessionStorage.save({
        operatorUuid: result.operator_uuid,
        operatorUsername: result.operator_username,
        isSuperuser: result.is_superuser,
        csrfToken: result.csrf_token,
      });
      pendingCredentials.current = null;
      setHasPendingLogin(false);
      setOperator(result.operator_username);
      setOperatorUuid(result.operator_uuid);
      setIsSuperuser(result.is_superuser);
      setStatus('authenticated');
    },
    [api],
  );

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // Best-effort — logging out locally must not get stuck waiting on a network call
      // that may never succeed (the gateway could already be unreachable).
    }
    pendingCredentials.current = null;
    setHasPendingLogin(false);
    await sessionStorage.clear();
    setOperator(null);
    setOperatorUuid(null);
    setIsSuperuser(false);
    setStatus('unauthenticated');
  }, [api]);

  const handleAuthError = useCallback((error: unknown): boolean => {
    if (
      error instanceof ApiError &&
      (error.code === 'session_expired' ||
        error.code === 'unauthorized' ||
        error.code === 'invalid_csrf')
    ) {
      sessionStorage.clear().catch(() => {});
      setOperator(null);
      setOperatorUuid(null);
      setIsSuperuser(false);
      setStatus('unauthenticated');
      return true;
    }
    return false;
  }, []);

  const value = useMemo(
    () => ({
      status,
      operator,
      operatorUuid,
      isSuperuser,
      hasPendingLogin,
      beginLogin,
      completeLogin,
      logout,
      handleAuthError,
    }),
    [
      status,
      operator,
      operatorUuid,
      isSuperuser,
      hasPendingLogin,
      beginLogin,
      completeLogin,
      logout,
      handleAuthError,
    ],
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

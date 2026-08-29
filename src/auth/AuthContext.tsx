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

import { ApiError, createApiClient, isApiError } from '@/api';
import type { LoginAuthenticated, LoginEnrollmentRequired } from '@/api';
import { useEnvironment } from '@/config/EnvironmentContext';

import { sessionStorage } from './sessionStorage';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

type AuthContextValue = {
  status: AuthStatus;
  operator: string | null;
  operatorUuid: string | null;
  isSuperuser: boolean;
  // Whether beginLogin()/checkLoginStatus() has stashed credentials awaiting completeLogin() (or
  // confirmEnrollment()) — the TOTP/enroll screens' own guard against being reached with nothing
  // pending (deep link, back/forward on web), replacing the old challengeId route-param check.
  // Deliberately a boolean, not the raw username/password themselves — nothing outside this
  // provider ever reads those directly.
  hasPendingLogin: boolean;
  // OC-77 / ZG-73 (proposed): set by checkLoginStatus() when the gateway reports the pending
  // operator has no confirmed TOTP enrollment yet — the QR/secret the new /enroll screen renders.
  // `null` whenever there's nothing to enroll (the common case: an already-confirmed operator).
  pendingEnrollment: LoginEnrollmentRequired | null;
  // Synchronous, no network — stores username/password in-memory only (never sessionStorage,
  // never a route param) for completeLogin() to use once the operator enters their TOTP code.
  // A password must never transit through anything URL-shaped (OC-55 design doc).
  beginLogin: (username: string, password: string) => void;
  // OC-77 / ZG-73 (proposed): the real first step of login now that a bare "stash and navigate
  // to /totp" can no longer be correct for an operator who hasn't enrolled TOTP yet. Makes the
  // one real `/login` call with an empty `totp_code` (the gateway's own sentinel for "I don't
  // have a code yet") and returns which screen the caller should navigate to next:
  // - 'enrollment': the gateway reported `enrollment_required` — credentials + the QR/secret are
  //   now stashed (`pendingEnrollment`), caller should push `/enroll`.
  // - 'totp': every other outcome (already-confirmed operator awaiting a real code, OR a
  //   genuinely wrong password/username) — indistinguishable from each other by design (the
  //   gateway's `rejected()` is one generic response for both), so this falls through to the
  //   existing `/totp` screen exactly as before this feature existed; a wrong password surfaces
  //   there as a wrong-code error on submit, same as it always has.
  // Throws only for a real connectivity failure (network/timeout) — the caller should show that
  // as an error on the login screen itself, not navigate anywhere.
  checkLoginStatus: (username: string, password: string) => Promise<'enrollment' | 'totp'>;
  // Fires the one real request the real gateway actually expects (username + password + TOTP
  // together). On failure, does NOT clear the pending credentials — a wrong code should only
  // need retyping the code, not the whole form again. `authTotpCode` (ZG-61): the operator's
  // own xindeler-auth-account 2FA code, if they have that enabled — unrelated to `totpCode`.
  completeLogin: (totpCode: string, authTotpCode?: string) => Promise<void>;
  // OC-77 / ZG-73 (proposed): confirms the pending TOTP enrollment `checkLoginStatus` surfaced.
  // Does NOT authenticate the operator — matches the real gateway's `enroll_confirm`, which mints
  // no session — so on success this clears all pending state and the caller returns to `/login`
  // for a normal login with the now-confirmed code (the exact 3-step flow Matías asked for).
  confirmEnrollment: (totpCode: string, authTotpCode?: string) => Promise<void>;
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
  const [pendingEnrollment, setPendingEnrollment] = useState<LoginEnrollmentRequired | null>(null);
  const pendingCredentials = useRef<{ username: string; password: string } | null>(null);

  const api = useMemo(() => createApiClient(environment.baseUrl), [environment.baseUrl]);

  useEffect(() => {
    let cancelled = false;
    sessionStorage
      .read()
      .then(async (stored) => {
        if (cancelled) return;
        // No server-communicated expiry to check locally (the real gateway's login response
        // has no `expires_at` — OC-55) — a persisted session record is treated as optimistically
        // authenticated; the first real request that actually fails (session_expired/
        // unauthorized) demotes via handleAuthError below, same as it already does today.
        // final-review Minor: a device upgrading from before OC-55 may still have an
        // old-shaped `{operator, expiresAt}` record in storage — `operatorUsername` being
        // present is enough to distinguish a genuinely new-shaped record from a stale one,
        // without needing a full schema-validation library for one field check.
        if (stored && typeof stored.operatorUsername === 'string') {
          setOperator(stored.operatorUsername);
          setOperatorUuid(stored.operatorUuid);
          setIsSuperuser(stored.isSuperuser);
          setStatus('authenticated');
          return;
        }
        if (stored) {
          await sessionStorage.clear();
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
    // final-review finding, Critical: a session for one gateway is meaningless against
    // another, and the same is true of credentials mid-flow — without this, an operator who
    // switches environments while sitting on the TOTP screen (reachable via this stack's own
    // EnvironmentBadge) could have completeLogin() send the OLD gateway's username/password to
    // the NEW gateway's /api/v1/login, since `api` is memoized on environment.baseUrl and
    // completeLogin reads whatever is still in pendingCredentials.current. Clearing both here
    // forces `hasPendingLogin` false, which bounces `/totp` back to `/login` via its own
    // Redirect guard — the operator re-enters credentials against the gateway they actually
    // chose, rather than the request going out silently misdirected.
    pendingCredentials.current = null;
    setHasPendingLogin(false);
    setPendingEnrollment(null);
  }, [environment.baseUrl]);

  const beginLogin = useCallback((username: string, password: string) => {
    pendingCredentials.current = { username, password };
    setHasPendingLogin(true);
    setPendingEnrollment(null);
  }, []);

  // Shared tail of every path that ends in a real, authenticated session (completeLogin's normal
  // case, and checkLoginStatus's defensive "somehow already authenticated" branch below).
  const finishLogin = useCallback(async (result: LoginAuthenticated) => {
    await sessionStorage.save({
      operatorUuid: result.operator_uuid,
      operatorUsername: result.operator_username,
      isSuperuser: result.is_superuser,
      csrfToken: result.csrf_token,
      sessionToken: result.session_token,
    });
    pendingCredentials.current = null;
    setHasPendingLogin(false);
    setPendingEnrollment(null);
    setOperator(result.operator_username);
    setOperatorUuid(result.operator_uuid);
    setIsSuperuser(result.is_superuser);
    setStatus('authenticated');
  }, []);

  const checkLoginStatus = useCallback(
    async (username: string, password: string): Promise<'enrollment' | 'totp'> => {
      try {
        const result = await api.auth.login(username, password, '');
        if (result.status === 'enrollment_required') {
          pendingCredentials.current = { username, password };
          setPendingEnrollment(result);
          setHasPendingLogin(true);
          return 'enrollment';
        }
        // Unreachable in practice — the real gateway's TOTP verification never accepts an empty
        // code — but handled rather than assumed, same as this file's other defensive branches.
        await finishLogin(result);
        return 'totp';
      } catch (err) {
        // A real connectivity failure (network/timeout) is not an auth signal — let the caller
        // show it as an error instead of silently routing to a screen that can't help.
        if (!isApiError(err)) throw err;
        // Every other outcome (wrong password, or a correct password on an already-confirmed
        // operator who just hasn't typed a real code yet) is the gateway's one generic
        // rejection, indistinguishable by design — fall through to the existing /totp flow
        // exactly as this app behaved before checkLoginStatus existed.
        pendingCredentials.current = { username, password };
        setHasPendingLogin(true);
        setPendingEnrollment(null);
        return 'totp';
      }
    },
    [api, finishLogin],
  );

  const completeLogin = useCallback(
    async (totpCode: string, authTotpCode?: string) => {
      const pending = pendingCredentials.current;
      if (!pending) {
        throw new Error('completeLogin called with no pending credentials');
      }
      const result = await api.auth.login(
        pending.username,
        pending.password,
        totpCode,
        authTotpCode,
      );
      if (result.status !== 'authenticated') {
        // Reachable only if an operator's TOTP status somehow reverted to unenrolled between
        // checkLoginStatus and this call — treat as a normal login failure rather than crash on
        // the missing session fields.
        throw new ApiError(
          'unauthorized',
          'La sesión ya no es válida, iniciá sesión de nuevo',
          401,
        );
      }
      await finishLogin(result);
    },
    [api, finishLogin],
  );

  const confirmEnrollment = useCallback(
    async (totpCode: string, authTotpCode?: string) => {
      const pending = pendingCredentials.current;
      if (!pending) {
        throw new Error('confirmEnrollment called with no pending credentials');
      }
      await api.auth.enrollConfirm(pending.username, pending.password, totpCode, authTotpCode);
      // Matías's own spec (step 3): confirming enrollment does NOT log the operator in — it
      // returns them to a normal login with usuario/contraseña, now completed with the
      // just-confirmed TOTP code. Clearing everything here (rather than keeping the credentials
      // around as a shortcut) also gets the raw password out of memory as soon as it's no longer
      // needed.
      pendingCredentials.current = null;
      setHasPendingLogin(false);
      setPendingEnrollment(null);
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
    setPendingEnrollment(null);
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
      pendingEnrollment,
      beginLogin,
      checkLoginStatus,
      completeLogin,
      confirmEnrollment,
      logout,
      handleAuthError,
    }),
    [
      status,
      operator,
      operatorUuid,
      isSuperuser,
      hasPendingLogin,
      pendingEnrollment,
      beginLogin,
      checkLoginStatus,
      completeLogin,
      confirmEnrollment,
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

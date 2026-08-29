import type { createHttpClient } from './httpClient';
import { LoginResultSchema } from './schemas';

type HttpClient = ReturnType<typeof createHttpClient>;

export function createAuthApi(http: HttpClient) {
  return {
    // One-shot login (OC-55) — the real xindeler-zuul gateway takes username, password, AND
    // totp_code in a single request (login.rs:19-41) and returns the session directly; there is
    // no server-side "challenge" concept. Bare `/api/v1/login`, NOT nested under `/api/v1/auth/`
    // — confirmed directly against the real route table (web.rs:38), matching `stepUp`'s own
    // bare-path precedent below. No token/expires_at in the response — the session lives entirely
    // in an HttpOnly cookie; native's own way of using a bearer credential is OC-58 (blocked on
    // xindeler-zuul's ZG-52), not this method.
    // `authTotpCode`: ZG-61 — a second, unrelated TOTP code an operator's own xindeler-auth
    // account may have enabled (entirely separate from `totpCode`, the operator's Zuul
    // enrollment). Omitted from the body entirely when not provided, matching the real
    // gateway's `Option<String>` field — sending `auth_totp_code: undefined` would still
    // serialize as present-with-null in some JSON.stringify paths, so this builds the body
    // conditionally rather than always including the key.
    // OC-77 / ZG-73 (proposed): `totpCode` may now be sent as `''` — the sentinel a first-time
    // operator's client sends before it knows whether they have a confirmed TOTP enrollment.
    // The response discriminates on `status` (see LoginResultSchema) rather than the caller
    // needing to guess in advance which shape is coming back.
    login(username: string, password: string, totpCode: string, authTotpCode?: string) {
      return http.request(
        '/api/v1/login',
        {
          method: 'POST',
          body: {
            username,
            password,
            totp_code: totpCode,
            ...(authTotpCode ? { auth_totp_code: authTotpCode } : {}),
          },
        },
        LoginResultSchema,
      );
    },

    logout(): Promise<void> {
      return http.request('/api/v1/logout', { method: 'POST' });
    },

    // OC-77 / ZG-73 (proposed, EXPECTED SHAPE NOT CONFIRMED): completes a pending TOTP
    // enrollment. Mirrors xindeler-zuul's real, already-shipped `POST /api/v1/enroll/confirm`
    // (ZG-38) — that route exists today but is only ever called from the SSH-only
    // `enroll-operator` CLI flow; this is its first real client caller. Re-authenticates with
    // username+password (no session cookie exists yet at this point in the flow) exactly like
    // `login` does. `204` on success, no body — confirming enrollment does NOT mint a session;
    // the operator logs in normally afterward with their now-confirmed code.
    enrollConfirm(
      username: string,
      password: string,
      totpCode: string,
      authTotpCode?: string,
    ): Promise<void> {
      return http.request('/api/v1/enroll/confirm', {
        method: 'POST',
        body: {
          username,
          password,
          totp_code: totpCode,
          ...(authTotpCode ? { auth_totp_code: authTotpCode } : {}),
        },
      });
    },

    // Session-scoped step-up (OC-54) — establishes a 5-minute window on the CURRENT session
    // during which destructive routes (gateway-api-contract.md §4/§5) allow writes with no extra
    // header. Bare `/api/v1/step-up`, deliberately NOT nested under `/api/v1/auth/` like this
    // file's other methods — the real xindeler-zuul route (`web.rs`) is bare `/step-up`,
    // confirmed directly against its source. `204` on success, no body.
    stepUp(totpCode: string): Promise<void> {
      return http.request('/api/v1/step-up', { method: 'POST', body: { totp_code: totpCode } });
    },
  };
}

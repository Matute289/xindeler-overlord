import type { createHttpClient } from './httpClient';
import { EnrollBeginResponseSchema, LoginResultSchema } from './schemas';

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
    // `totpCode` may be sent as `''` — the sentinel a client sends before it knows whether the
    // operator has a confirmed TOTP enrollment. OC-77 round 2 / ZG-73 (final): unlike round 1,
    // the response NEVER carries a secret — an unenrolled operator just gets
    // `{status: 'enrollment_required'}`, full stop. The only path to a QR/secret is
    // `enrollBegin()` below, via an emailed invite link, never this call.
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

    // Session-scoped step-up (OC-54) — establishes a 5-minute window on the CURRENT session
    // during which destructive routes (gateway-api-contract.md §4/§5) allow writes with no extra
    // header. Bare `/api/v1/step-up`, deliberately NOT nested under `/api/v1/auth/` like this
    // file's other methods — the real xindeler-zuul route (`web.rs`) is bare `/step-up`,
    // confirmed directly against its source. `204` on success, no body.
    stepUp(totpCode: string): Promise<void> {
      return http.request('/api/v1/step-up', { method: 'POST', body: { totp_code: totpCode } });
    },

    // OC-77 round 2 / ZG-73 (final contract, 2026-08-29): unauthenticated — no session, no CSRF
    // — the operator hasn't logged in yet at this point. `token` comes from the query string of
    // the emailed invite link (`https://zuul.xindeler.com/enroll?token=...`), read by the
    // `/enroll` screen itself, not from any login-flow state. This is the ONLY route that ever
    // returns a TOTP secret/QR now.
    enrollBegin(token: string) {
      return http.request(
        '/api/v1/enroll/begin',
        { method: 'POST', body: { token } },
        EnrollBeginResponseSchema,
      );
    },

    // Unchanged from the real gateway's ZG-38 design — re-authenticates with username+password
    // (no session exists yet) and completes a *pending* enrollment (the one `enrollBegin` just
    // showed the QR for). `204` on success, no body, mints no session — the operator logs in
    // normally afterward.
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
  };
}

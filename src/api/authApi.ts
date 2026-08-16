import type { createHttpClient } from './httpClient';
import { LoginResponseSchema, TotpResponseSchema } from './schemas';

type HttpClient = ReturnType<typeof createHttpClient>;

export function createAuthApi(http: HttpClient) {
  return {
    login(username: string, password: string) {
      return http.request(
        '/api/v1/auth/login',
        { method: 'POST', body: { username, password } },
        LoginResponseSchema,
      );
    },

    totp(challengeId: string, code: string) {
      return http.request(
        '/api/v1/auth/totp',
        { method: 'POST', body: { challenge_id: challengeId, code } },
        TotpResponseSchema,
      );
    },

    // Currently unwired — no caller anywhere in this app. Whoever wires this must call
    // sessionStorage.save({...}) with BOTH the new `token` and the new `csrfToken` from the
    // response (the mock's /refresh now rotates both), or subsequent writes will 403 with a
    // stale CSRF token.
    refresh() {
      return http.request('/api/v1/auth/refresh', { method: 'POST' }, TotpResponseSchema);
    },

    logout(): Promise<void> {
      return http.request('/api/v1/auth/logout', { method: 'POST' });
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

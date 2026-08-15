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
  };
}

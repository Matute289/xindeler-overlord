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

    refresh() {
      return http.request('/api/v1/auth/refresh', { method: 'POST' }, TotpResponseSchema);
    },

    logout(): Promise<void> {
      return http.request('/api/v1/auth/logout', { method: 'POST' });
    },
  };
}

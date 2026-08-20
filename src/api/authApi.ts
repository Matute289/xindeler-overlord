import type { createHttpClient } from './httpClient';
import { LoginResponseSchema } from './schemas';

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
    login(username: string, password: string, totpCode: string) {
      return http.request(
        '/api/v1/login',
        { method: 'POST', body: { username, password, totp_code: totpCode } },
        LoginResponseSchema,
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
  };
}

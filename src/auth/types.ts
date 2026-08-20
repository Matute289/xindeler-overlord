export type StoredSession = {
  operatorUuid: string;
  operatorUsername: string;
  isSuperuser: boolean;
};

// No `expiresAt` — the real gateway's login response has none (OC-55; the session lives
// entirely in an HttpOnly cookie/bearer token, and there's no server-communicated expiry to
// store). `sessionToken` (OC-58, xindeler-zuul's ZG-52) is native's own bearer credential —
// present in the shared save payload since both platforms receive the same login response, but
// only native's `SecureSessionStorage` ever reads it back out; web's own `read()` strips it the
// same way it already strips `csrfToken` from what screens see.
export type SaveSessionInput = StoredSession & { csrfToken: string; sessionToken: string };

export interface SessionStorage {
  save(session: SaveSessionInput): Promise<void>;
  read(): Promise<StoredSession | null>;
  clear(): Promise<void>;
  /**
   * Native: `{ Authorization: 'Bearer <sessionToken>' }`, read from `expo-secure-store` (OC-58,
   * xindeler-zuul's ZG-52 — the real gateway now accepts this as an alternative to the cookie,
   * checked only when no session cookie is present). Web: always `undefined` — the browser
   * attaches the HttpOnly session cookie automatically, and the real gateway checks that first
   * regardless, so a web-side bearer header would be redundant. `undefined` if no session exists
   * on either platform.
   */
  getAuthHeader(): Promise<Record<string, string> | undefined>;
  /**
   * `{ 'x-csrf-token': '<token>' }` on both platforms — unlike a bearer token, the CSRF token
   * is never a secret in the "only native can hold it" sense: it exists specifically to be
   * readable by this origin's own JS (that's the whole mechanism), so both platforms return a
   * real header here, not just native. `undefined` if no session exists.
   */
  getCsrfHeader(): Promise<Record<string, string> | undefined>;
}

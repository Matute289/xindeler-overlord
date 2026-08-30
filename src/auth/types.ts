export type StoredSession = {
  operatorUuid: string;
  operatorUsername: string;
  isSuperuser: boolean;
};

// No `expiresAt` — the real gateway's login response has none (OC-55; the session lives
// entirely in an HttpOnly cookie/bearer token, and there's no server-communicated expiry to
// store). `sessionToken` (OC-58, xindeler-zuul's ZG-52) is a bearer credential — present in the
// shared save payload since both platforms receive the same login response. Both platforms'
// `SecureSessionStorage` persist and read it back out as of OC-85 (ZG-72, 2026-08-30) — web used
// to strip it (same-origin cookie was enough then), but the Web build now runs cross-origin from
// Zuul and has no cookie to fall back on; `read()` still strips it the same way it strips
// `csrfToken` from what screens see, since neither belongs in ordinary app state.
export type SaveSessionInput = StoredSession & { csrfToken: string; sessionToken: string };

export interface SessionStorage {
  save(session: SaveSessionInput): Promise<void>;
  read(): Promise<StoredSession | null>;
  clear(): Promise<void>;
  /**
   * `{ Authorization: 'Bearer <sessionToken>' }` on both platforms as of OC-85 (ZG-72) — native
   * reads it from `expo-secure-store` (OC-58, xindeler-zuul's ZG-52), web from `localStorage`
   * (the only thing resembling secure storage a browser offers; see
   * `SecureSessionStorage.web.ts`'s own comment for the accepted trade-off). The real gateway's
   * shared `auth_extractor.rs` checks a session cookie first, Bearer as the fallback — web no
   * longer has a cookie to check regardless, since it's cross-origin from Zuul and `SameSite=Strict`
   * blocks it either way, so Bearer is effectively its only path now. `undefined` if no session
   * exists on either platform.
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

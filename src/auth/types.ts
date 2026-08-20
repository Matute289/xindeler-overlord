export type StoredSession = {
  operatorUuid: string;
  operatorUsername: string;
  isSuperuser: boolean;
};

// No `token`/`expiresAt` — the real gateway's login response has neither (OC-55; the session
// lives entirely in an HttpOnly cookie, and there's no server-communicated expiry to store).
// Native's own way of presenting a session credential is OC-58 (blocked on xindeler-zuul's
// ZG-52), not this type.
export type SaveSessionInput = StoredSession & { csrfToken: string };

export interface SessionStorage {
  save(session: SaveSessionInput): Promise<void>;
  read(): Promise<StoredSession | null>;
  clear(): Promise<void>;
  /**
   * No working native bearer mechanism exists yet (OC-55/OC-58) — the real gateway is
   * cookie-only and native has no way to present a session credential today. Always
   * `undefined` on both platforms until OC-58 (blocked on xindeler-zuul's ZG-52) adds a real
   * one for native.
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

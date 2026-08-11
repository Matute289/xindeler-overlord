export type StoredSession = {
  operator: string;
  expiresAt: string;
};

// `save()` takes the bearer token so the native backend can persist it — but
// `read()` never returns it back. Callers that need to authenticate a
// request call `getAuthHeader()` instead; nothing else should see the raw
// token, on either platform.
export type SaveSessionInput = StoredSession & { token: string };

export interface SessionStorage {
  save(session: SaveSessionInput): Promise<void>;
  read(): Promise<StoredSession | null>;
  clear(): Promise<void>;
  /**
   * Native: `{ Authorization: 'Bearer <token>' }`, read from the platform's
   * secure storage. Web: always `undefined` — the browser attaches the
   * HttpOnly session cookie automatically; requests must be made with
   * `credentials: 'include'` instead (an OC-14 concern).
   */
  getAuthHeader(): Promise<Record<string, string> | undefined>;
}

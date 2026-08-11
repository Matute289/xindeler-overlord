import type { SaveSessionInput, SessionStorage, StoredSession } from './types';

const METADATA_KEY = 'overlord.session.metadata';

// The real credential is the browser's HttpOnly session cookie, which this
// module never touches — the `token` field of `SaveSessionInput` is
// deliberately discarded here, not stored anywhere. `localStorage` only
// holds a non-secret marker so the UI can optimistically know "there was a
// session" without waiting on a network round trip; it is not what enforces
// auth. See docs/specs/2026-08-11-secure-session-storage-design.md.
export const sessionStorage: SessionStorage = {
  async save({ token: _token, ...metadata }: SaveSessionInput) {
    localStorage.setItem(METADATA_KEY, JSON.stringify(metadata));
  },

  async read(): Promise<StoredSession | null> {
    const raw = localStorage.getItem(METADATA_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  },

  async clear() {
    localStorage.removeItem(METADATA_KEY);
  },

  async getAuthHeader() {
    return undefined;
  },
};

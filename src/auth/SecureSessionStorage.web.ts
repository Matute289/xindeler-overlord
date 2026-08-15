import type { SaveSessionInput, SessionStorage, StoredSession } from './types';

const METADATA_KEY = 'overlord.session.metadata';

type StoredMetadataWithCsrf = StoredSession & { csrfToken: string };

// The real credential is the browser's HttpOnly session cookie, which this
// module never touches — the `token` field of `SaveSessionInput` is
// deliberately discarded here, not stored anywhere. `localStorage` only
// holds a non-secret marker so the UI can optimistically know "there was a
// session" without waiting on a network round trip; it is not what enforces
// auth. See docs/specs/2026-08-11-secure-session-storage-design.md.
//
// `csrfToken` is the one exception to "nothing secret lives here" — it
// isn't secret in that sense. A CSRF token exists specifically to be
// readable by this origin's own JS (that's the whole mechanism: proving the
// request came from a script that could read this origin's storage, which a
// cross-site attacker's forged request can't), so it's stored here
// alongside the metadata rather than discarded like `token` is.
export const sessionStorage: SessionStorage = {
  async save({ token: _token, ...rest }: SaveSessionInput) {
    localStorage.setItem(METADATA_KEY, JSON.stringify(rest));
  },

  async read(): Promise<StoredSession | null> {
    const stored = readStoredMetadata();
    if (!stored) return null;
    const { csrfToken: _csrfToken, ...metadata } = stored;
    return metadata;
  },

  async clear() {
    localStorage.removeItem(METADATA_KEY);
  },

  async getAuthHeader() {
    return undefined;
  },

  async getCsrfHeader() {
    const stored = readStoredMetadata();
    return stored ? { 'x-csrf-token': stored.csrfToken } : undefined;
  },
};

function readStoredMetadata(): StoredMetadataWithCsrf | null {
  const raw = localStorage.getItem(METADATA_KEY);
  return raw ? (JSON.parse(raw) as StoredMetadataWithCsrf) : null;
}

import type { SaveSessionInput, SessionStorage, StoredSession } from './types';

const METADATA_KEY = 'overlord.session.metadata';

type StoredMetadataWithSecrets = StoredSession & { csrfToken?: string; sessionToken?: string };

// The real credential is the browser's HttpOnly session cookie, which this module never
// touches. `localStorage` only holds a non-secret marker so the UI can optimistically know
// "there was a session" without waiting on a network round trip; it is not what enforces auth.
// See docs/specs/2026-08-11-secure-session-storage-design.md.
//
// `csrfToken` is the one exception to "nothing secret lives here" — it isn't secret in that
// sense. A CSRF token exists specifically to be readable by this origin's own JS (that's the
// whole mechanism: proving the request came from a script that could read this origin's
// storage, which a cross-site attacker's forged request can't), so it's stored here alongside
// the metadata. `sessionToken` (OC-58) is genuinely secret — a full bearer credential, not a
// double-submit value — and web never needs it (`getAuthHeader()` always returns `undefined`
// here, the cookie already carries the session), so `save()` strips it before ever writing to
// `localStorage`; `read()` strips it again on the way out as defense in depth, not as the only
// safeguard.
export const sessionStorage: SessionStorage = {
  async save(session: SaveSessionInput) {
    // final-review Critical, OC-58: `sessionToken` is a full bearer credential and web never
    // needs it — `getAuthHeader()` below is a hardcoded `undefined` on this platform, the
    // HttpOnly/SameSite=Strict cookie already carries the session. Persisting it anyway would
    // put in origin-readable `localStorage` the exact value HttpOnly exists to keep out of JS's
    // reach — converting a cookie an attacker's script can't touch into one it can just read.
    // Stripped here, at write time, not just on read: read()'s own strip below is defense in
    // depth for records written by this build, not a substitute for never writing it at all.
    const { sessionToken: _sessionToken, ...persisted } = session;
    localStorage.setItem(METADATA_KEY, JSON.stringify(persisted));
  },

  async read(): Promise<StoredSession | null> {
    const stored = readStoredMetadata();
    if (!stored) return null;
    const { csrfToken: _csrfToken, sessionToken: _sessionToken, ...metadata } = stored;
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
    return stored?.csrfToken ? { 'x-csrf-token': stored.csrfToken } : undefined;
  },
};

function readStoredMetadata(): StoredMetadataWithSecrets | null {
  const raw = localStorage.getItem(METADATA_KEY);
  return raw ? (JSON.parse(raw) as StoredMetadataWithSecrets) : null;
}

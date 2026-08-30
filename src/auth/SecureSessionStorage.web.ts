import type { SaveSessionInput, SessionStorage, StoredSession } from './types';

const METADATA_KEY = 'overlord.session.metadata';

type StoredMetadataWithSecrets = StoredSession & { csrfToken?: string; sessionToken?: string };

// OC-85 (ZG-72): this file's original design (docs/specs/2026-08-11-secure-session-storage-design.md)
// assumed web always ran same-origin with Zuul, authenticated via an `HttpOnly` cookie the browser
// attached automatically, and never touched `sessionToken` at all — that assumption is gone now
// that the Web build is served from its own origin (`overlord.xindeler.com`) and calls Zuul
// (`zuul.xindeler.com`) cross-origin. Zuul's CORS response for that origin carries no
// `Access-Control-Allow-Credentials`, so a cross-origin `HttpOnly` cookie was never going to reach
// it anyway (`SameSite=Strict` blocks it regardless) — `sessionToken` (a Bearer credential, same
// field native's own `SecureSessionStorage.native.ts` already reads) is now the ONLY credential
// this platform has, so it has to live somewhere this module's own `getAuthHeader()` can read it
// back to attach to every request, same as native's `expo-secure-store` does.
//
// `localStorage` is the only thing resembling "this platform's own secure storage" a browser
// offers — there's no OS-level secure enclave equivalent to native's Keychain/Keystore reachable
// from web JS at all. That means this token is genuinely exposed to any script that can run in
// this origin (e.g. an XSS), which `expo-secure-store` on native is not — a real, accepted
// trade-off (Matías, 2026-08-30), not an oversight: Overlord's operators are trusted staff, not
// the public, and this app's CSP (OC-81/ZG-76/ZG-77) already narrows the realistic XSS surface.
// The alternative (in-memory only, never persisted) would force a fresh login — TOTP included —
// on every page reload, an unacceptable cost for software people keep open all day.
//
// `csrfToken` was already stored here regardless (see below) — it isn't secret in the same sense.
export const sessionStorage: SessionStorage = {
  async save(session: SaveSessionInput) {
    localStorage.setItem(METADATA_KEY, JSON.stringify(session));
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

  // OC-85 (ZG-72): mirrors native's SecureSessionStorage.native.ts exactly — same field, same
  // header shape, same real gateway route (`auth_extractor.rs`'s shared cookie-or-Bearer
  // precedence) now serving both platforms identically.
  async getAuthHeader() {
    const stored = readStoredMetadata();
    return stored?.sessionToken ? { Authorization: `Bearer ${stored.sessionToken}` } : undefined;
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

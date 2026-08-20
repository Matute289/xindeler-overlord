import * as SecureStore from 'expo-secure-store';

import type { SaveSessionInput, SessionStorage, StoredSession } from './types';

const SESSION_KEY = 'overlord.session';

type StoredSessionWithSecrets = StoredSession & { csrfToken?: string; sessionToken?: string };

export const sessionStorage: SessionStorage = {
  async save(session: SaveSessionInput) {
    // Single write, not separate token/metadata writes - two writes can be
    // interrupted between them, leaving read() and getCsrfHeader()
    // disagreeing about whether a session exists.
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  },

  async read(): Promise<StoredSession | null> {
    const stored = await readStoredSession();
    if (!stored) return null;
    const { csrfToken: _csrfToken, sessionToken: _sessionToken, ...metadata } = stored;
    return metadata;
  },

  async clear() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },

  // OC-58 (xindeler-zuul's ZG-52) — the real gateway now accepts a bearer token as an
  // alternative to the session cookie for native, which has no HTTP cookie jar of its own.
  async getAuthHeader() {
    const stored = await readStoredSession();
    return stored?.sessionToken ? { Authorization: `Bearer ${stored.sessionToken}` } : undefined;
  },

  async getCsrfHeader() {
    const stored = await readStoredSession();
    return stored?.csrfToken ? { 'x-csrf-token': stored.csrfToken } : undefined;
  },
};

async function readStoredSession(): Promise<StoredSessionWithSecrets | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  return raw ? (JSON.parse(raw) as StoredSessionWithSecrets) : null;
}

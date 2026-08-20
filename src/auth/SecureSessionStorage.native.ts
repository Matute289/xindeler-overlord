import * as SecureStore from 'expo-secure-store';

import type { SaveSessionInput, SessionStorage, StoredSession } from './types';

const SESSION_KEY = 'overlord.session';

type StoredSessionWithCsrf = StoredSession & { csrfToken?: string };

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
    const { csrfToken: _csrfToken, ...metadata } = stored;
    return metadata;
  },

  async clear() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },

  // No working native bearer mechanism yet — see types.ts's doc comment. OC-58 (blocked on
  // xindeler-zuul's ZG-52) replaces this once the real gateway actually supports it.
  async getAuthHeader() {
    return undefined;
  },

  async getCsrfHeader() {
    const stored = await readStoredSession();
    return stored?.csrfToken ? { 'x-csrf-token': stored.csrfToken } : undefined;
  },
};

async function readStoredSession(): Promise<StoredSessionWithCsrf | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  return raw ? (JSON.parse(raw) as StoredSessionWithCsrf) : null;
}

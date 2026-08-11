import * as SecureStore from 'expo-secure-store';

import type { SaveSessionInput, SessionStorage, StoredSession } from './types';

const TOKEN_KEY = 'overlord.session.token';
const METADATA_KEY = 'overlord.session.metadata';

export const sessionStorage: SessionStorage = {
  async save({ token, ...metadata }: SaveSessionInput) {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(METADATA_KEY, JSON.stringify(metadata));
  },

  async read(): Promise<StoredSession | null> {
    const raw = await SecureStore.getItemAsync(METADATA_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  },

  async clear() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(METADATA_KEY);
  },

  async getAuthHeader() {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : undefined;
  },
};

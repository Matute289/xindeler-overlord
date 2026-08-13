import * as Crypto from 'expo-crypto';

import { sessionStorage } from '../auth/sessionStorage';
import { createAuthApi } from './authApi';
import { createHttpClient } from './httpClient';
import { createReadApi } from './readApi';

export function createApiClient(baseUrl: string) {
  const http = createHttpClient(baseUrl, {
    getAuthHeader: () => sessionStorage.getAuthHeader(),
    generateIdempotencyKey: () => Crypto.randomUUID(),
  });

  return {
    auth: createAuthApi(http),
    read: createReadApi(http),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

import * as Crypto from 'expo-crypto';

import { sessionStorage } from '../auth/sessionStorage';
import { createAuthApi } from './authApi';
import { createHttpClient } from './httpClient';
import { createReadApi } from './readApi';
import { createWriteApi } from './writeApi';

export function createApiClient(baseUrl: string) {
  const http = createHttpClient(baseUrl, {
    getAuthHeader: () => sessionStorage.getAuthHeader(),
    getCsrfHeader: () => sessionStorage.getCsrfHeader(),
    generateIdempotencyKey: () => Crypto.randomUUID(),
  });

  return {
    auth: createAuthApi(http),
    read: createReadApi(http),
    write: createWriteApi(http),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

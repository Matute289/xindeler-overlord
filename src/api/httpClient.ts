import type { ZodType } from 'zod';

import { ApiError } from './errors';
import { ErrorEnvelopeSchema } from './schemas';

const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [300, 900];
const PARSE_FAILED = Symbol('parse-failed');

type HttpClientDeps = {
  getAuthHeader: () => Promise<Record<string, string> | undefined>;
  getCsrfHeader: () => Promise<Record<string, string> | undefined>;
  generateIdempotencyKey: () => string;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  // When provided, used INSTEAD of `deps.generateIdempotencyKey()` — safety-review finding 6,
  // 2026-08-14. Without this, a caller that needs to send the same logical mutation twice (e.g.
  // `useDestructiveAction`'s retry-once-on-403 step-up flow) has no way to make the two attempts
  // share one idempotency key, since a fresh one was generated inside every `request()` call.
  idempotencyKey?: string;
};

export function createHttpClient(baseUrl: string, deps: HttpClientDeps) {
  async function request<T>(
    path: string,
    options: RequestOptions,
    responseSchema?: ZodType<T>,
  ): Promise<T> {
    const method = options.method ?? 'GET';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      const authHeader = await deps.getAuthHeader();
      const csrfHeader = method !== 'GET' ? await deps.getCsrfHeader() : undefined;
      const headers: Record<string, string> = {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(authHeader ?? {}),
        ...(csrfHeader ?? {}),
        ...(method !== 'GET'
          ? { 'Idempotency-Key': options.idempotencyKey ?? deps.generateIdempotencyKey() }
          : {}),
      };

      let response: Response;
      try {
        response = await fetch(`${baseUrl}${path}`, {
          method,
          headers,
          credentials: 'include',
          signal: controller.signal,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new ApiError('timeout', 'La solicitud tardó demasiado', 0);
        }
        throw new ApiError('network_error', 'No se pudo conectar con el gateway', 0);
      }

      if (!response.ok) {
        // The real gateway sends a plain-text body (not this doc's own JSON envelope) for many
        // error responses -- confirmed 2026-08-15 (OC-54) and again during OC-59's own
        // investigation (OC-57's admin routes, OC-59's audit/broadcast routes). A `Response`
        // body can only be consumed once, so read it as text first and attempt to parse THAT as
        // JSON, rather than calling `.json()` directly and losing the raw text on failure.
        const rawText = await response.text().catch(() => '');
        let envelopeCandidate: unknown;
        try {
          envelopeCandidate = JSON.parse(rawText);
        } catch {
          envelopeCandidate = null;
        }
        const parsed = ErrorEnvelopeSchema.safeParse(envelopeCandidate);
        if (parsed.success) {
          throw new ApiError(parsed.data.error.code, parsed.data.error.message, response.status);
        }
        // Not the JSON envelope -- surface the raw text directly when there's something legible
        // to show, instead of a generic status-code-only message. Capped defensively (a real,
        // known-small backend body never approaches this, but an unexpected huge/binary body
        // shouldn't render unbounded).
        const MAX_RAW_ERROR_LEN = 500;
        const trimmed = rawText.trim().slice(0, MAX_RAW_ERROR_LEN);
        throw new ApiError(
          'unknown_error',
          trimmed.length > 0 ? trimmed : `Error inesperado del gateway (${response.status})`,
          response.status,
        );
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const json = await response.json().catch(() => PARSE_FAILED);
      if (json === PARSE_FAILED) {
        throw new ApiError(
          'invalid_response',
          'La respuesta del gateway no tiene el formato esperado',
          response.status,
        );
      }
      if (!responseSchema) {
        return json as T;
      }
      const result = responseSchema.safeParse(json);
      if (!result.success) {
        throw new ApiError(
          'invalid_response',
          'La respuesta del gateway no tiene el formato esperado',
          response.status,
        );
      }
      return result.data;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function requestWithRetry<T>(
    path: string,
    options: RequestOptions,
    responseSchema?: ZodType<T>,
  ): Promise<T> {
    if ((options.method ?? 'GET') !== 'GET') {
      throw new Error('requestWithRetry is GET-only — mutations must use request() directly');
    }
    let lastError: ApiError | undefined;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await request(path, options, responseSchema);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        lastError = err;
        const isRetryable =
          err.code === 'network_error' || err.code === 'timeout' || err.status >= 500;
        if (!isRetryable || attempt === RETRY_DELAYS_MS.length) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    }
    // Unreachable — the loop above always either returns or throws — but keeps TS satisfied.
    throw lastError;
  }

  return { request, requestWithRetry };
}

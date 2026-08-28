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
  // OC-70: opt-in for the handful of routes whose body genuinely carries useful, schema-shaped
  // data even on a non-2xx response — confirmed real for `POST /players/{segment}/ban`/`/unban`,
  // whose `outcome: 'failed'` case ships on a `502` (`xindeler-zuul/server/src/players.rs`) but
  // still serializes the same `BanPlayerResponse`/`UnbanPlayerResponse` shape as every other
  // outcome. Without this, that body never reaches the caller's own `outcome`-based UI copy — it
  // gets treated as a generic transport error before ever being read. Deliberately per-call, not
  // global: most non-2xx bodies are genuinely just errors, and blindly parsing all of them against
  // `responseSchema` would risk masking a real failure as a false "success" for routes that were
  // never designed with this dual meaning.
  parseNonOkBodyAsData?: boolean;
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
        throw new ApiError('network_error', 'No se pudo conectar con Zuul', 0);
      }

      if (!response.ok) {
        // The real Zuul sends a plain-text body (not this doc's own JSON envelope) for many
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
        // OC-70: checked before the error-envelope path below — a route that opted in and whose
        // body genuinely matches its own success shape gets returned as data, not thrown as an
        // error, regardless of status code.
        if (options.parseNonOkBodyAsData && responseSchema && envelopeCandidate !== null) {
          const asData = responseSchema.safeParse(envelopeCandidate);
          if (asData.success) {
            return asData.data;
          }
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
        // OC-64: the real gateway's plain-text auth rejections carry no JSON code at all (see the
        // comment above), so `AuthContext.handleAuthError`'s code-based check
        // (`session_expired`/`unauthorized`/`invalid_csrf`) never fired against production --
        // every session expiry/revocation fell through to `unknown_error` and left the app stuck
        // showing `authenticated`. A 401 here always means "not logged in" server-side
        // (`auth_extractor.rs`/`login.rs`), so it's safe to classify unconditionally.
        // A 403's plain-text body still needs distinguishing: `require_step_up` (`lifecycle.rs`)
        // sends "step-up required" for a normal, recoverable, non-auth-failure state that
        // `useDestructiveAction` already handles by retrying on `status === 403` alone (never
        // reads `code` for this) -- classifying it as `invalid_csrf` here would incorrectly log
        // the operator out of an otherwise-healthy session. `authorize`'s own CSRF check sends
        // "invalid csrf token", which genuinely does warrant one.
        let code = 'unknown_error';
        if (response.status === 401) {
          code = 'unauthorized';
        } else if (response.status === 403) {
          const lower = trimmed.toLowerCase();
          if (lower.includes('csrf')) {
            code = 'invalid_csrf';
          } else if (lower.includes('step-up') || lower.includes('step up')) {
            code = 'step_up_required';
          }
        }
        throw new ApiError(
          code,
          trimmed.length > 0 ? trimmed : `Error inesperado de Zuul (${response.status})`,
          response.status,
        );
      }

      // OC-69: `202` (only ever used for `POST /server/restart`, confirmed the sole real use of
      // that status anywhere in `xindeler-zuul`) carries no body either, same as `204` -- without
      // this, `restartServer()` (which used to pass a `{ok:true}`-shaped schema here) tried to
      // parse an empty body, failed, and threw `invalid_response` on every restart the operator
      // issued, even when the restart itself had genuinely just been accepted.
      if (response.status === 204 || response.status === 202) {
        return undefined as T;
      }

      const json = await response.json().catch(() => PARSE_FAILED);
      if (json === PARSE_FAILED) {
        throw new ApiError(
          'invalid_response',
          // Ghostbusters reference (Matías's request), quiet enough to still read fine to anyone
          // who's never seen the movie: "dogs and cats living together" is Peter Venkman's line
          // for total chaos — not found verbatim in Matías's own script PDF (likely an ad-lib,
          // per Matías), but still one of the most widely recognized lines from the film.
          "La respuesta de Zuul no tiene el formato esperado (esto sí que es 'perros y gatos viviendo juntos')",
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
          // Ghostbusters reference (Matías's request), quiet enough to still read fine to anyone
          // who's never seen the movie: "dogs and cats living together" is Peter Venkman's line
          // for total chaos — not found verbatim in Matías's own script PDF (likely an ad-lib,
          // per Matías), but still one of the most widely recognized lines from the film.
          "La respuesta de Zuul no tiene el formato esperado (esto sí que es 'perros y gatos viviendo juntos')",
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

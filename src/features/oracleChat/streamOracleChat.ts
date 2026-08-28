import { ApiError } from '@/api';
import {
  ChatMessageSchema,
  DmEventSchema,
  ErrorEnvelopeSchema,
  OracleChatTokenSchema,
  type ChatMessage,
  type DmEvent,
} from '@/api/schemas';
import { parseSseStream } from '@/stream/sseParser';

// Same 10-second convention `httpClient.ts` (`DEFAULT_TIMEOUT_MS`) and `StreamClient.ts`
// (`CONNECT_TIMEOUT_MS`) already use. Two phases, one mechanism: the timer is armed before the
// POST (connect) and re-armed on every SSE event that arrives (idle). A backend that accepts the
// request and then stalls mid-response is the case that actually strands this screen — the
// composer's `sending` flag is global, so a stream that never ends disables it forever — and only
// an idle deadline can end that. Every re-arm is driven by observed progress, so a healthy stream
// (the mock emits a token every 80ms; a real model streams far faster than one token per 10s)
// never trips it.
const CONNECT_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 10_000;

export type OracleChatStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'draft'; draft: DmEvent }
  | { type: 'context'; snippets: ChatMessage[] };

// A minimal fetch-shaped type for exactly the fields this module passes — mirrors the same
// approach `StreamClient.ts` uses for its own GET-only equivalent, so both `expo/fetch` and
// Node's global `fetch` satisfy it without a type-compatibility fight.
type PostFetchInit = {
  method: 'POST';
  headers: Record<string, string>;
  credentials: 'include';
  body: string;
  signal: AbortSignal;
};
export type FetchLike = (url: string, init: PostFetchInit) => Promise<Response>;

export type StreamOracleChatDeps = {
  getAuthHeader: () => Promise<Record<string, string> | undefined>;
  fetchImpl: FetchLike;
};

// `POST /api/v1/oracle/chat` opens its own `text/event-stream` response directly on this
// request — it is NOT part of the shared `/api/v1/stream` connection (`StreamClient`'s
// `StreamEventMap`), so this is a standalone, one-shot generator rather than a subscription
// through that machinery. No reconnect/backoff logic: the mock's stream ends after the
// terminal `draft` event or an error, and there is nothing to reconnect to mid-message.
//
// Every failure path out of here throws an `ApiError`, never a bare `Error`: that is what lets
// the caller route a 401 into `AuthContext.handleAuthError` (which matches on
// `code === 'unauthorized' | 'session_expired'`) and what lets `isLikelyVpnDown` recognise a
// `status: 0` / `network_error` failure on the `wireguard` environment. A plain `Error` would be
// invisible to both.
export async function* streamOracleChat(
  baseUrl: string,
  body: { message: string; thread_id: string },
  signal: AbortSignal,
  deps: StreamOracleChatDeps,
): AsyncGenerator<OracleChatStreamEvent> {
  // An internal controller so the timeout below can abort the request without touching the
  // caller's signal (which the caller owns for unmount/supersede aborts). The caller's signal is
  // forwarded into it, so either source aborts the same in-flight request.
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', forwardAbort);

  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  function armTimeout(ms: number) {
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
  }

  armTimeout(CONNECT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      const authHeader = await deps.getAuthHeader();
      response = await deps.fetchImpl(`${baseUrl}/api/v1/oracle/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Content negotiation, matching `StreamClient.ts`'s own GET request — the mock
          // ignores it, a real gateway or an intermediate proxy may not.
          Accept: 'text/event-stream',
          ...(authHeader ?? {}),
        },
        credentials: 'include',
        // ZG-67: `tier: 'bedrock'` is the ONLY valid value on the real gateway (`400
        // unsupported_tier` for anything else, confirmed by the session that shipped it) --
        // there is no local tier and never was one (CLAUDE.md's own Q6: Bedrock-exclusive, not
        // even as a first pass). Hardcoded here rather than exposed as a caller-supplied field,
        // same reasoning `writeApi.ts`'s `fireOracleEvent` hardcodes `dry_run: false` instead of
        // taking a `boolean` parameter — there is exactly one real value, so making it a
        // parameter is a footgun with no upside.
        body: JSON.stringify({ ...body, tier: 'bedrock' }),
        signal: controller.signal,
      });
    } catch {
      if (timedOut) {
        throw new ApiError('timeout', 'La solicitud tardó demasiado', 0);
      }
      if (signal.aborted) {
        throw new ApiError('aborted', 'La respuesta se canceló', 0);
      }
      throw new ApiError('network_error', 'No se pudo conectar con Zuul', 0);
    }
    // Headers are in — that's progress; the deadline now covers the stream body instead.
    armTimeout(IDLE_TIMEOUT_MS);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      const parsed = ErrorEnvelopeSchema.safeParse(errorBody);
      if (parsed.success) {
        throw new ApiError(parsed.data.error.code, parsed.data.error.message, response.status);
      }
      // A 401 with an unparseable body still has to reach `handleAuthError`, which matches on
      // the code — so synthesize the code the status already tells us, rather than dropping the
      // operator into an unrecoverable retry loop with a dead session.
      if (response.status === 401) {
        throw new ApiError('unauthorized', 'Tu sesión expiró, iniciá sesión de nuevo', 401);
      }
      throw new ApiError(
        'unknown_error',
        `Error inesperado de Zuul (${response.status})`,
        response.status,
      );
    }

    if (!response.body) {
      throw new ApiError(
        'invalid_response',
        'La respuesta de Zuul no tiene el formato esperado',
        response.status,
      );
    }

    const reader = response.body.getReader();
    try {
      for await (const event of parseSseStream(reader, controller.signal)) {
        armTimeout(IDLE_TIMEOUT_MS);
        if (event.event === 'token') {
          try {
            const parsed = OracleChatTokenSchema.safeParse(JSON.parse(event.data));
            if (parsed.success) yield { type: 'token', text: parsed.data.text };
          } catch {
            // Malformed JSON in one event — skip it, don't kill the whole stream.
          }
        } else if (event.event === 'draft') {
          try {
            const parsed = DmEventSchema.safeParse(JSON.parse(event.data));
            if (parsed.success) yield { type: 'draft', draft: parsed.data };
          } catch {
            // Malformed JSON in one event — skip it, don't kill the whole stream.
          }
        } else if (event.event === 'context') {
          try {
            const parsed = ChatMessageSchema.array().safeParse(JSON.parse(event.data));
            if (parsed.success) yield { type: 'context', snippets: parsed.data };
          } catch {
            // Malformed JSON in one event — skip it, don't kill the whole stream.
          }
        }
      }
    } catch (error) {
      // A read error mid-stream is a disconnect. Classify it the same way the connect phase
      // does so the caller gets one consistent error vocabulary, and leave a breadcrumb the way
      // `StreamClient.ts` does on its own read-loop failure — a swallowed read error was
      // exactly what made this path undiagnosable before.
      if (timedOut) {
        // Ghostbusters reference (Matías's request, verified verbatim in his own script PDF,
        // line 1323): Venkman's line right after the Sedgewick Hotel ghost hits him — fits a
        // stream that just went quiet and gross-surprise-stopped-making-sense either way.
        throw new ApiError(
          'timeout',
          'La respuesta de Zuul se quedó sin avanzar (¿nos habrán baboseado?)',
          0,
        );
      }
      if (signal.aborted) {
        throw new ApiError('aborted', 'La respuesta se canceló', 0);
      }
      console.warn('[oracle-chat] stream read loop ended', error);
      throw new ApiError('network_error', 'Se cortó la conexión con Zuul', 0);
    }
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    signal.removeEventListener('abort', forwardAbort);
    // Closing the generator early (the consumer `break`s, or an error unwinds it) must not
    // leave the HTTP request open — `parseSseStream` only cancels its reader, not the fetch.
    controller.abort();
  }
}

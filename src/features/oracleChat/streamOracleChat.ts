import { DmEventSchema, OracleChatTokenSchema, type DmEvent } from '@/api/schemas';
import { parseSseStream } from '@/stream/sseParser';

export type OracleChatStreamEvent =
  { type: 'token'; text: string } | { type: 'draft'; draft: DmEvent };

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
export async function* streamOracleChat(
  baseUrl: string,
  body: { message: string; thread_id: string; tier: 'local' | 'bedrock' },
  signal: AbortSignal,
  deps: StreamOracleChatDeps,
): AsyncGenerator<OracleChatStreamEvent> {
  const authHeader = await deps.getAuthHeader();
  const response = await deps.fetchImpl(`${baseUrl}/api/v1/oracle/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeader ?? {}) },
    credentials: 'include',
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`ORACLE chat request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  for await (const event of parseSseStream(reader, signal)) {
    if (event.event === 'token') {
      const parsed = OracleChatTokenSchema.safeParse(JSON.parse(event.data));
      if (parsed.success) yield { type: 'token', text: parsed.data.text };
    } else if (event.event === 'draft') {
      const parsed = DmEventSchema.safeParse(JSON.parse(event.data));
      if (parsed.success) yield { type: 'draft', draft: parsed.data };
    }
  }
}

import type { ChatMessage, DmEvent } from '@/api/schemas';

export type ChatTurn = {
  id: string;
  role: 'operator' | 'assistant';
  text: string;
  status: 'streaming' | 'complete' | 'failed';
  draft: DmEvent | null;
  // The actual error that failed this turn, kept so the row can render it through the app-wide
  // `zuulErrorMessage`/`ActionError` pattern (VPN diagnosis included) instead of a hardcoded
  // string that tells the operator nothing. Always `null` unless `status === 'failed'`.
  error: Error | null;
  // `null` for operator turns (they have no tier). Set once, when an assistant turn is created,
  // and read back by `retryTurn` so a retry resends on the SAME tier it originally used — a
  // Bedrock send that failed must not silently downgrade to a free local retry, which would be a
  // different, cheaper operation than what the operator actually asked for.
  tier: 'local' | 'bedrock' | null;
  // `null` for operator turns (they have no context) and for an assistant turn before its
  // `context` event arrives, or if the stream never sends one. Set once, when the `context`
  // event lands — before any tokens, matching the real ordering: what the model read is decided
  // before what it wrote.
  contextSnippets: ChatMessage[] | null;
};

export type ChatThread = {
  id: string;
  turns: ChatTurn[];
};

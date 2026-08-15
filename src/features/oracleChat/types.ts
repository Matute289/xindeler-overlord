import type { DmEvent } from '@/api/schemas';

export type ChatTurn = {
  id: string;
  role: 'operator' | 'assistant';
  text: string;
  status: 'streaming' | 'complete' | 'failed';
  draft: DmEvent | null;
  // The actual error that failed this turn, kept so the row can render it through the app-wide
  // `gatewayErrorMessage`/`ActionError` pattern (VPN diagnosis included) instead of a hardcoded
  // string that tells the operator nothing. Always `null` unless `status === 'failed'`.
  error: Error | null;
};

export type ChatThread = {
  id: string;
  turns: ChatTurn[];
};

import type { DmEvent } from '@/api/schemas';

export type ChatTurn = {
  id: string;
  role: 'operator' | 'assistant';
  text: string;
  status: 'streaming' | 'complete' | 'failed';
  draft: DmEvent | null;
};

export type ChatThread = {
  id: string;
  turns: ChatTurn[];
};

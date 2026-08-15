# Tier Switch + Budget (OC-43) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Pensar mejor" action next to the chat composer that sends the current message on the
Bedrock tier instead of local, labeled with month-to-date spend from `GET /oracle/budget`.

**Architecture:** `streamOracleChat.ts`'s existing `tier: 'local' | 'bedrock'` type is finally used for
real — `send`/`retryTurn`/`runAssistantTurn` in `useOracleChatThreads.ts` gain a `tier` parameter
instead of hardcoding `'local'`. A new plain `useOracleBudgetQuery` (mirroring the existing
`useOraclePresetsQuery` shape) feeds the button's label. `ChatTurn` gains a `tier` field so retry
resends with the same tier it originally used, and `ChatTurnRow` shows which tier answered.

**Tech Stack:** Existing TanStack Query infrastructure — no new dependencies.

## Global Constraints

- Two separate actions ("Enviar" / "Pensar mejor"), never a persistent toggle — a toggle would leave
  Bedrock silently "on" for every message after the operator forgets to flip it back.
- "Pensar mejor" is a `Pressable` + `Text`, NOT a second `Button` — `Button` is hardcoded `w-full`, and
  two of them sharing a row is the exact overlap bug OC-34's kill switch hit and fixed.
- No budget threshold alerts, no polling/refetch-on-send for the budget query — the mock's budget
  numbers are static and don't change with usage, so there's nothing real to threshold or refresh
  against.
- No change to `streamOracleChat.ts`'s existing `body.tier` type — it already accepts
  `'local' | 'bedrock'`, this ticket only starts sending the second value from a real call site.
- Retry must resend with the SAME tier the failed turn originally used, not silently downgrade to
  `local`.
- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check`, plus the live pass in Task 2.

---

### Task 1: Budget schema/query + `tier` threaded through the chat hook

**Files:**
- Modify: `src/api/schemas.ts`
- Modify: `src/api/readApi.ts`
- Modify: `src/api/queryClient.ts`
- Create: `src/features/oracleChat/useOracleBudgetQuery.ts`
- Modify: `src/features/oracleChat/types.ts`
- Modify: `src/features/oracleChat/useOracleChatThreads.ts`

**Interfaces:**
- Consumes: `createHttpClient`'s `requestWithRetry` (already exists); `useApi`/`useAuthErrorRouting`
  (already exist).
- Produces: `OracleBudgetResponseSchema`/`type OracleBudgetResponse` (`@/api/schemas`);
  `api.read.getOracleBudget()`; `queryKeys.oracleBudget`; `useOracleBudgetQuery()`
  (`./useOracleBudgetQuery`); `ChatTurn.tier: 'local' | 'bedrock' | null`; `send(threadId, text, tier)`,
  `retryTurn(threadId, assistantTurnId)` (unchanged signature, now tier-aware internally) — all
  consumed by Task 2.

- [ ] **Step 1: Add `OracleBudgetResponseSchema` to `src/api/schemas.ts`**

Read the current file first. Add near the existing `OracleChatTokenSchema` block:

```ts
export const OracleBudgetResponseSchema = z.object({
  month_to_date_tokens: z.number(),
  month_to_date_cost_usd: z.number(),
  tier_breakdown: z.object({
    local: z.object({ tokens: z.number(), cost_usd: z.number() }),
    bedrock: z.object({ tokens: z.number(), cost_usd: z.number() }),
  }),
});
export type OracleBudgetResponse = z.infer<typeof OracleBudgetResponseSchema>;
```

- [ ] **Step 2: Add `getOracleBudget` to `src/api/readApi.ts`**

Read the current file first. Add the import (`OracleBudgetResponseSchema`) and the method, matching
the existing `getOraclePresets`/`getOracleEvents` shape exactly:

```ts
getOracleBudget() {
  return http.requestWithRetry(
    '/api/v1/oracle/budget',
    { method: 'GET' },
    OracleBudgetResponseSchema,
  );
},
```

- [ ] **Step 3: Add `oracleBudget` to `src/api/queryClient.ts`'s `queryKeys`**

```ts
oracleBudget: ['oracleBudget'] as const,
```

- [ ] **Step 4: Write `src/features/oracleChat/useOracleBudgetQuery.ts`**

```ts
import { useQuery } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';

export function useOracleBudgetQuery() {
  const api = useApi();

  const query = useQuery({
    queryKey: queryKeys.oracleBudget,
    queryFn: () => api.read.getOracleBudget(),
  });

  useAuthErrorRouting(query.error);

  return query;
}
```

No stream involvement, no refetch overrides — same reasoning as every other plain-read hook in this
app: nothing streams into this cache, so TanStack's default refetch-on-focus/remount is correct.

- [ ] **Step 5: Add `tier` to `ChatTurn` in `src/features/oracleChat/types.ts`**

Read the current file first. Add one field to the existing type:

```ts
export type ChatTurn = {
  id: string;
  role: 'operator' | 'assistant';
  text: string;
  status: 'streaming' | 'complete' | 'failed';
  draft: DmEvent | null;
  error: Error | null;
  // `null` for operator turns (they have no tier). Set once, when an assistant turn is created,
  // and read back by `retryTurn` so a retry resends on the SAME tier it originally used — a
  // Bedrock send that failed must not silently downgrade to a free local retry, which would be a
  // different, cheaper operation than what the operator actually asked for.
  tier: 'local' | 'bedrock' | null;
};
```

- [ ] **Step 6: Thread `tier` through `src/features/oracleChat/useOracleChatThreads.ts`**

Read the current file first (shown in full above in this ticket's context — confirm it still matches).

Change `runAssistantTurn`'s signature and its `streamOracleChat` call — currently:

```ts
  const runAssistantTurn = useCallback(
    async (threadId: string, operatorText: string, assistantTurnId: string) => {
      // Defensive: a previous controller that is somehow still live is superseded rather than
      // left dangling on a request nobody is reading any more.
      abortRef.current?.abort();
      setSending(true);
      sendingRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      let receivedDraft = false;
      try {
        for await (const event of streamOracleChat(
          environment.baseUrl,
          { message: operatorText, thread_id: threadId, tier: 'local' },
          controller.signal,
```

to:

```ts
  const runAssistantTurn = useCallback(
    async (
      threadId: string,
      operatorText: string,
      assistantTurnId: string,
      tier: 'local' | 'bedrock',
    ) => {
      // Defensive: a previous controller that is somehow still live is superseded rather than
      // left dangling on a request nobody is reading any more.
      abortRef.current?.abort();
      setSending(true);
      sendingRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      let receivedDraft = false;
      try {
        for await (const event of streamOracleChat(
          environment.baseUrl,
          { message: operatorText, thread_id: threadId, tier },
          controller.signal,
```

(The rest of `runAssistantTurn`'s body — the token/draft handling, the `!receivedDraft` branch, the
catch block, the `finally` block — is unchanged. Its dependency array stays `[environment.baseUrl]`.)

Change `send` — currently:

```ts
  const send = useCallback(
    async (threadId: string, text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || sendingRef.current) return;

      const operatorTurn: ChatTurn = {
        id: Crypto.randomUUID(),
        role: 'operator',
        text: trimmed,
        status: 'complete',
        draft: null,
        error: null,
      };
      const assistantTurn: ChatTurn = {
        id: Crypto.randomUUID(),
        role: 'assistant',
        text: '',
        status: 'streaming',
        draft: null,
        error: null,
      };
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id !== threadId
            ? thread
            : { ...thread, turns: [...thread.turns, operatorTurn, assistantTurn] },
        ),
      );

      await runAssistantTurn(threadId, trimmed, assistantTurn.id);
    },
    [runAssistantTurn],
  );
```

to:

```ts
  const send = useCallback(
    async (threadId: string, text: string, tier: 'local' | 'bedrock') => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || sendingRef.current) return;

      const operatorTurn: ChatTurn = {
        id: Crypto.randomUUID(),
        role: 'operator',
        text: trimmed,
        status: 'complete',
        draft: null,
        error: null,
        tier: null,
      };
      const assistantTurn: ChatTurn = {
        id: Crypto.randomUUID(),
        role: 'assistant',
        text: '',
        status: 'streaming',
        draft: null,
        error: null,
        tier,
      };
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id !== threadId
            ? thread
            : { ...thread, turns: [...thread.turns, operatorTurn, assistantTurn] },
        ),
      );

      await runAssistantTurn(threadId, trimmed, assistantTurn.id, tier);
    },
    [runAssistantTurn],
  );
```

Change `retryTurn` — currently:

```ts
  const retryTurn = useCallback(
    async (threadId: string, assistantTurnId: string) => {
      if (sendingRef.current) return;
      const thread = threadsRef.current.find((t) => t.id === threadId);
      const index = thread?.turns.findIndex((t) => t.id === assistantTurnId) ?? -1;
      if (!thread || index <= 0) return;
      const operatorTurn = thread.turns[index - 1];
      if (operatorTurn.role !== 'operator') return;

      updateTurn(threadId, assistantTurnId, (turn) => ({
        ...turn,
        text: '',
        status: 'streaming',
        draft: null,
        error: null,
      }));
      await runAssistantTurn(threadId, operatorTurn.text, assistantTurnId);
    },
    [runAssistantTurn],
  );
```

to:

```ts
  const retryTurn = useCallback(
    async (threadId: string, assistantTurnId: string) => {
      if (sendingRef.current) return;
      const thread = threadsRef.current.find((t) => t.id === threadId);
      const index = thread?.turns.findIndex((t) => t.id === assistantTurnId) ?? -1;
      if (!thread || index <= 0) return;
      const operatorTurn = thread.turns[index - 1];
      const assistantTurn = thread.turns[index];
      if (operatorTurn.role !== 'operator') return;
      const tier = assistantTurn.tier ?? 'local';

      updateTurn(threadId, assistantTurnId, (turn) => ({
        ...turn,
        text: '',
        status: 'streaming',
        draft: null,
        error: null,
      }));
      await runAssistantTurn(threadId, operatorTurn.text, assistantTurnId, tier);
    },
    [runAssistantTurn],
  );
```

- [ ] **Step 7: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 8: Commit**

```bash
git add src/api/schemas.ts src/api/readApi.ts src/api/queryClient.ts src/features/oracleChat/useOracleBudgetQuery.ts src/features/oracleChat/types.ts src/features/oracleChat/useOracleChatThreads.ts
git commit -m "feat(oc43): oracle budget schema/query, tier threaded through chat send/retry"
```

---

### Task 2: "Pensar mejor" UI + tier label on rows + live verify + backlog

**Files:**
- Modify: `src/features/oracleChat/OracleChatScreen.tsx`
- Modify: `src/features/oracleChat/ChatTurnRow.tsx`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `useOracleBudgetQuery` (Task 1); `ChatTurn.tier` (Task 1); `send(threadId, text, tier)`
  (Task 1, already used by `OracleChatScreen.tsx`, now takes a third argument).
- Produces: nothing consumed by a later task — end of this plan's chain.

- [ ] **Step 1: Add the "Pensar mejor" action to `OracleChatScreen.tsx`**

Read the current file first (shown in full above in this ticket's context — confirm it still matches).

Add the import: `import { useOracleBudgetQuery } from './useOracleBudgetQuery';`

Inside `OracleChatScreen()`, right after the existing
`const { threads, activeThreadId, setActiveThreadId, createThread, send, retryTurn, sending } =
useOracleChatThreads();` line, add:

```ts
  const budgetQuery = useOracleBudgetQuery();
```

Change `handleSend` to pass the tier explicitly — currently:

```ts
  async function handleSend() {
    const text = draftText;
    // Gated on exactly the conditions `send` itself early-returns on, so the composer is never
    // cleared for a message that was never turned into a turn. (Unreachable through the Enviar
    // button, which is disabled under both — but silent data loss shouldn't depend on that.)
    if (text.trim().length === 0 || sending) return;
    setDraftText('');
    await send(activeThread.id, text);
  }
```

to:

```ts
  async function handleSend() {
    const text = draftText;
    // Gated on exactly the conditions `send` itself early-returns on, so the composer is never
    // cleared for a message that was never turned into a turn. (Unreachable through the Enviar
    // button, which is disabled under both — but silent data loss shouldn't depend on that.)
    if (text.trim().length === 0 || sending) return;
    setDraftText('');
    await send(activeThread.id, text, 'local');
  }

  async function handleThinkHarder() {
    const text = draftText;
    if (text.trim().length === 0 || sending) return;
    setDraftText('');
    await send(activeThread.id, text, 'bedrock');
  }
```

Then, in the JSX, inside the bottom composer `View`, add the "Pensar mejor" action right after the
existing `<Button label="Enviar" ... />` block — currently that block ends with:

```tsx
        <Button
          label="Enviar"
          onPress={handleSend}
          loading={sending}
          disabled={draftText.trim().length === 0 || sending}
        />
      </View>
    </View>
  );
}
```

Change to:

```tsx
        <Button
          label="Enviar"
          onPress={handleSend}
          loading={sending}
          disabled={draftText.trim().length === 0 || sending}
        />
        <Pressable
          onPress={handleThinkHarder}
          accessibilityRole="button"
          accessibilityState={{ disabled: draftText.trim().length === 0 || sending }}
          disabled={draftText.trim().length === 0 || sending}
          className="items-center"
        >
          <Text
            className={
              draftText.trim().length === 0 || sending
                ? 'text-steel-muted dark:text-night-steel-muted'
                : 'text-accent-cyan dark:text-night-accent-cyan'
            }
            style={{ fontFamily: fonts.semibold }}
          >
            {budgetQuery.data
              ? `Pensar mejor ($${budgetQuery.data.month_to_date_cost_usd.toFixed(2)} este mes)`
              : 'Pensar mejor'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Show which tier answered in `ChatTurnRow.tsx`**

Read the current file first (shown in full earlier in this ticket's context — confirm it still
matches). Change the role-label `<Text>` — currently:

```tsx
      <Text
        className="text-accent-cyan dark:text-night-accent-cyan"
        style={{ fontFamily: fonts.semibold }}
      >
        {turn.role === 'operator' ? 'Operador' : 'ORACLE'}
      </Text>
```

to:

```tsx
      <Text
        className="text-accent-cyan dark:text-night-accent-cyan"
        style={{ fontFamily: fonts.semibold }}
      >
        {turn.role === 'operator'
          ? 'Operador'
          : turn.tier === 'bedrock'
            ? 'ORACLE (Bedrock)'
            : 'ORACLE'}
      </Text>
```

- [ ] **Step 3: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 4: Live verification**

Prerequisite: `npm run mock-gateway` running, `npx expo start --web` running, logged in (`matias`/mock,
TOTP `000000`).

1. Navigate to `/oracle-chat`. Confirm "Pensar mejor" renders below "Enviar" with the mock's
   month-to-date cost in its label (check `tools/mock-gateway/src/routes/oracleBudget.js` for the
   exact static value to expect, e.g. `$3.42`).
2. Type a message, tap "Pensar mejor" (not "Enviar"). Confirm the network request body carries
   `"tier":"bedrock"` (inspect via devtools/network tab), and the resulting assistant row's label
   reads "ORACLE (Bedrock)".
3. Type another message, tap "Enviar". Confirm the request carries `"tier":"local"`, and the row reads
   plain "ORACLE".
4. Confirm both "Enviar" and "Pensar mejor" are disabled together when the composer is empty and while
   a send is in progress (they must never independently become enabled/disabled from each other).
5. Force a Bedrock send to fail (same technique as OC-41's own live pass — e.g. intercept and reject
   the `POST /api/v1/oracle/chat` request). Confirm the row shows the failed state with "Reintentar",
   tap it, and confirm the RETRY request also carries `"tier":"bedrock"` (not `"local"`) — this is the
   one behavior that can't be seen just by looking at the screen, check the network request directly.

- [ ] **Step 5: Update `docs/backlog.md`'s OC-43 row**

Change the row's status cell from `⬜` to `✅`. Describe: the two-actions-not-a-toggle design decision
and why, the budget query (plain read, no polling, why), the `tier` field added to `ChatTurn` and why
retry preserves it, the "ORACLE (Bedrock)" row label, and the live verification performed (all 5
checks). Match the terse, factual style of the existing OC-13 through OC-42 rows.

- [ ] **Step 6: Commit**

```bash
git add src/features/oracleChat/OracleChatScreen.tsx src/features/oracleChat/ChatTurnRow.tsx docs/backlog.md
git commit -m "feat(oc43): Pensar mejor (Bedrock tier) action with budget label"
```

---

## Self-Review

**Spec coverage:** The two-actions-not-a-toggle design, the plain budget read with no invented polling,
retry preserving the original tier, the "ORACLE (Bedrock)" honesty label, and the live verification plan
(including the retry-preserves-tier check, the one behavior not visible without inspecting the network
request) are all covered across the two tasks. "Out of scope" items (budget threshold alerts, changes to
`streamOracleChat.ts`'s type, untrusted-content provenance) — no task builds any of them. ✅

**Placeholder scan:** No TBD/TODO — full literal code throughout, including the exact 5-step live
verification sequence and the exact button/label copy.

**Type consistency:** `OracleBudgetResponse`/`getOracleBudget()`/`queryKeys.oracleBudget` (Task 1) are
consumed identically by Task 1's own `useOracleBudgetQuery`, which Task 2 consumes directly with no
further wrapping. `ChatTurn.tier` (Task 1) is set consistently in `send`'s `operatorTurn`/`assistantTurn`
construction, read consistently in `retryTurn`, and read consistently in Task 2's `ChatTurnRow` render.
`send(threadId, text, tier)`'s three-argument signature (Task 1) matches exactly how Task 2's
`handleSend`/`handleThinkHarder` both call it (`'local'` / `'bedrock'` respectively).

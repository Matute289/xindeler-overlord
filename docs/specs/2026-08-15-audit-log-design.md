# Audit log screen (OC-28) design

## What ships

Backlog: *"Durable gateway rows: who, when, what, outcome. This is what makes write access
reviewable."* Almost all the plumbing already exists, anticipated by earlier tickets: `AuditRowSchema`/
`AuditRow`/`AuditResponseSchema` (`src/api/schemas.ts`, from OC-17), `getAudit(limit?)`
(`src/api/readApi.ts`), `queryKeys.audit(limit?)` (`src/api/queryClient.ts`, its own comment already
names "OC-28 audit" as the anticipated consumer), and the `audit` SSE event already wired into
`StreamEventMap`. This ticket is the screen and the one small hook needed to bootstrap-then-stream it
— genuinely the smallest remaining piece.

## Why this list is newest-first, and has no follow-tail

Every prior live-updating screen (Logs OC-20, Chat OC-21) is a "watch it scroll by" surface — appended
chronologically, oldest-to-newest, with a follow-tail toggle to decide whether new entries auto-scroll
into view. Audit is a different kind of screen: an operator opens it to *review what already
happened* (who stopped the server and when, who broadcast what), not to watch it live during play.
Newest-first (reverse chronological) is the standard convention for an activity/audit log for exactly
this reason — the answer to "what just happened" is at the top, no scrolling needed. No follow-tail
toggle, no scroll-disengage state machine (the single most bug-prone mechanism in this app's whole
history, per Logs' five review rounds) — this screen structurally doesn't need it, so it doesn't get
it, the same reasoning OC-21 already used to justify skipping Logs' batching machinery for Chat.

## The data hook

New `src/features/audit/useAuditQuery.ts`, following Chat's "plain synchronous append, no batching, no
cap, no `_seq`" shape (OC-21's precedent) rather than Logs' buffered-flush shape — audit events are
one per operator-initiated action (start/stop/restart/cancel/disconnect/broadcast), the same
low-frequency profile as chat, not a flood:

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import type { AuditRow } from '@/api/schemas';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';
import { useStreamEvent } from '@/stream/StreamContext';

const BOOTSTRAP_LIMIT = 50;

export function useAuditQuery() {
  const api = useApi();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.audit(BOOTSTRAP_LIMIT);

  const query = useQuery({
    queryKey,
    queryFn: () => api.read.getAudit(BOOTSTRAP_LIMIT),
  });

  useAuthErrorRouting(query.error);

  // New rows are prepended, not appended — this screen displays newest-first (see the design
  // spec's "why newest-first" section), unlike Logs/Chat.
  useStreamEvent('audit', (row) => {
    queryClient.setQueryData(queryKey, (old: AuditRow[] | undefined) => [row, ...(old ?? [])]);
  });

  return query;
}
```

No cap on the buffer — audit rows are rare enough (one per human action) that unbounded growth over
even a very long session is not a practical concern, the same call OC-21 made for chat.

## The row + screen

New `src/features/audit/AuditRow.tsx` (memoized, matching `LogRow`/`ChatMessageRow`'s established
shape) — shows formatted time, operator, action, an outcome badge (`ok` green-ish /
`error` red, reusing this app's `accent-cyan`/`danger` tokens the same way `LogRow`'s level colors
do), and a compact one-line rendering of `payload` (via `JSON.stringify`, omitted entirely when the
payload is `{}`) plus `detail` when present (only set on error outcomes, per
`tools/mock-gateway/src/audit.js`'s `recordAudit`).

New `src/features/audit/AuditScreen.tsx` — a plain `FlatList` over the (already newest-first, per the
hook) rows, no toggle, no scroll handling beyond what `FlatList` gives for free. Uses the existing
`GatewayErrorEmpty`/`Empty` pattern for the loading/error states, identical to every other screen.

## Where this lives

Not a 7th primary tab — the existing tab bar (Status/Jugadores/Logs/Chat/ORACLE/Más) already covers
this app's "watch it during play" surfaces; Audit is a "check it occasionally" surface, the same
category "Más" already exists for. `app/(tabs)/more.tsx` currently has no sub-navigation of any kind
(just the environment switcher and logout) — this ticket adds the first one: a simple "Auditoría" link
above the existing content, routing to a new `app/(tabs)/audit.tsx` (still inside the `(tabs)` group,
so it inherits `EnvironmentBadge`/`StreamStatusBanner`/`StepUpProvider` the same as every tab, it's
just not one of the buttons `DESTINATIONS` renders). This establishes the pattern future secondary
screens (e.g. OC-50/51's ORACLE-adjacent placeholders) can reuse instead of each needing its own tab.

## Testing

No test runner — `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass: open
`more.tsx`, tap "Auditoría", confirm the bootstrap rows render newest-first; trigger a real write
action elsewhere in the app (e.g. the Status screen's Iniciar/Detener from OC-25/26, or a broadcast
from OC-27) and confirm the resulting audit row appears at the TOP of this list live, without a
refresh; confirm an error-outcome row (e.g. a deliberately wrong step-up code, or Cancelar with no
active drain) shows its `detail` text and an error-styled badge.

## Out of scope

- Filtering/searching audit rows — no such requirement in the backlog line.
- A follow-tail toggle — see "Why this list is newest-first" above.
- Pagination beyond the 50-row bootstrap — no backlog requirement, revisit if it becomes a real need.

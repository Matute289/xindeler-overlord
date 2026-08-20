# Audit Row Shape Fix + Operator Identity (OC-56) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace this app's stale, partially-invented `AuditRowSchema` with the real, deployed
`xindeler-zuul` gateway's actual `AuditEntry` shape, and update every consumer (the audit list
screen, the mock gateway that exercises it locally) to match — closing `OC-56`.

**Architecture:** A single Zod schema (`AuditRowSchema`) is the one source of truth for the
audit-row shape, consumed by both the `GET /audit` fetch and the live `audit` SSE event. Fixing
the schema and its two UI consumers (`AuditRow.tsx`, `AuditScreen.tsx`) is Task 1. The mock
gateway that stands in for the real one during local development needs a matching rewrite so it
keeps being a truthful stand-in — that's Task 2, independent of Task 1's UI changes but sharing
the same target shape.

**Tech Stack:** TypeScript, Zod, React Native (Expo), Express (mock gateway, plain JS, no
TypeScript).

## Global Constraints

- No test runner exists in this repo — verification is `npx tsc --noEmit` / `npm run lint` /
  `npm run format:check`, plus a live pass. There is no `npm test` step in either task below.
- Every operator-facing string stays in Spanish — this ticket introduces no new user-facing
  strings, it only fixes a data shape, so this constraint is satisfied by not touching any JSX
  text content.
- Do not modify `formatTime` itself, `src/features/chat/ChatMessageRow.tsx`, or
  `src/features/logs/LogRow.tsx` — they are correct today and unrelated to this ticket. Only add
  a new sibling export.
- Do not build against `xindeler-zuul`'s unmerged `zg53`/`zg54`/`zg55` branch — `outcome:
  z.string()` (not a closed enum) already tolerates whatever that eventually ships without
  another client change.
- `id`/`created_at` are the real gateway's own row identity and timestamp — do not invent a
  client-side substitute for either.

---

## Task 1: Client — schema, formatter, and the two Auditoría UI files

**Files:**
- Modify: `src/api/schemas.ts` (the `AuditRowSchema` block, lines 76-84)
- Modify: `src/ui/formatTime.ts` (full file, 3 lines today)
- Modify: `src/features/audit/AuditRow.tsx` (full file)
- Modify: `src/features/audit/AuditScreen.tsx` (one line — `keyExtractor`)

**Interfaces:**
- Produces: `AuditRow` type (from `src/api/schemas.ts`) with shape `{ id: number; operator_uuid:
  string; operator_username: string; action: string; payload: Record<string, unknown>; outcome:
  string; created_at: number }` — this is what Task 2's mock gateway must serialize to match,
  and what every other current consumer of `AuditRow` (`useAuditQuery.ts`, `StreamClient.ts`)
  already imports by type, unchanged.
- Produces: `formatUnixTime(seconds: number): string` (new export from `src/ui/formatTime.ts`).
- Consumes: nothing from another task — this task is self-contained on the client side.

- [ ] **Step 1: Update `AuditRowSchema` in `src/api/schemas.ts`**

Find this block (lines 76-84):

```ts
export const AuditRowSchema = z.object({
  ts: z.string(),
  operator: z.string(),
  action: z.string(),
  payload: z.record(z.string(), z.unknown()),
  outcome: z.enum(['ok', 'error']),
  detail: z.string().optional(),
});
export type AuditRow = z.infer<typeof AuditRowSchema>;
export const AuditResponseSchema = z.array(AuditRowSchema);
```

Replace it with:

```ts
export const AuditRowSchema = z.object({
  id: z.number(),
  operator_uuid: z.string(),
  operator_username: z.string(),
  action: z.string(),
  payload: z.record(z.string(), z.unknown()),
  // Free-form, not a closed enum: the real gateway's `outcome` is a Rust `String`, currently
  // "success"/"failed" but xindeler-zuul already has unmerged work that adds more values (a
  // "requested" pre-mutation row, RestartOutcome variant names) -- modeling this as a closed
  // enum would just mean another client patch the moment that ships.
  outcome: z.string(),
  created_at: z.number(),
});
export type AuditRow = z.infer<typeof AuditRowSchema>;
export const AuditResponseSchema = z.array(AuditRowSchema);
```

Nothing else in this file changes — every other schema is unrelated.

- [ ] **Step 2: Verify no other schema in the file references the old field names**

Run: `grep -n "\.ts\b\|\.operator\b\|'ok'\|'error'" src/api/schemas.ts`

Expected: no remaining hits inside `AuditRowSchema` itself (hits in unrelated schemas elsewhere
in the file, if any, are not this ticket's concern — do not touch them).

- [ ] **Step 3: Add `formatUnixTime` to `src/ui/formatTime.ts`**

Current full file:

```ts
export function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('es-AR', { hour12: false });
}
```

Replace with:

```ts
export function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('es-AR', { hour12: false });
}

export function formatUnixTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString('es-AR', { hour12: false });
}
```

`formatTime` itself is untouched — `ChatMessageRow.tsx` and `LogRow.tsx` keep calling it with
real ISO-string timestamps from their own endpoints.

- [ ] **Step 4: Rewrite `src/features/audit/AuditRow.tsx`**

Current full file:

```tsx
import { memo } from 'react';
import { Text, View } from 'react-native';

import type { AuditRow } from '@/api/schemas';
import { fonts } from '@/ui/theme';
import { formatTime } from '@/ui/formatTime';

export const AuditLogRow = memo(function AuditLogRow({ row }: { row: AuditRow }) {
  const isError = row.outcome === 'error';
  const payloadText = Object.keys(row.payload).length > 0 ? JSON.stringify(row.payload) : null;

  return (
    <View className="border-b border-steel-dark px-4 py-2 dark:border-night-steel-dark">
      <View className="flex-row items-center gap-2">
        <View
          className={`rounded-full px-2 py-0.5 ${
            isError ? 'bg-danger dark:bg-night-danger' : 'bg-accent-cyan dark:bg-night-accent-cyan'
          }`}
        >
          <Text className="text-xs uppercase text-white" style={{ fontFamily: fonts.semibold }}>
            {row.outcome}
          </Text>
        </View>
        <Text
          className="text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.semibold }}
        >
          {row.action}
        </Text>
        <Text
          className="text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {formatTime(row.ts)}
        </Text>
      </View>
      <Text
        className="mt-0.5 text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.regular }}
      >
        {row.operator}
      </Text>
      {payloadText && (
        <Text
          className="mt-0.5 text-xs text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {payloadText}
        </Text>
      )}
      {row.detail && (
        <Text
          className="mt-0.5 text-xs text-danger dark:text-night-danger"
          style={{ fontFamily: fonts.regular }}
        >
          {row.detail}
        </Text>
      )}
    </View>
  );
});
```

Replace with:

```tsx
import { memo } from 'react';
import { Text, View } from 'react-native';

import type { AuditRow } from '@/api/schemas';
import { fonts } from '@/ui/theme';
import { formatUnixTime } from '@/ui/formatTime';

export const AuditLogRow = memo(function AuditLogRow({ row }: { row: AuditRow }) {
  const isError = row.outcome !== 'success';
  const payloadText = Object.keys(row.payload).length > 0 ? JSON.stringify(row.payload) : null;

  return (
    <View className="border-b border-steel-dark px-4 py-2 dark:border-night-steel-dark">
      <View className="flex-row items-center gap-2">
        <View
          className={`rounded-full px-2 py-0.5 ${
            isError ? 'bg-danger dark:bg-night-danger' : 'bg-accent-cyan dark:bg-night-accent-cyan'
          }`}
        >
          <Text className="text-xs uppercase text-white" style={{ fontFamily: fonts.semibold }}>
            {row.outcome}
          </Text>
        </View>
        <Text
          className="text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.semibold }}
        >
          {row.action}
        </Text>
        <Text
          className="text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {formatUnixTime(row.created_at)}
        </Text>
      </View>
      <Text
        className="mt-0.5 text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.regular }}
      >
        {row.operator_username}
      </Text>
      {payloadText && (
        <Text
          className="mt-0.5 text-xs text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {payloadText}
        </Text>
      )}
    </View>
  );
});
```

Four changes from the original: `isError` now checks `!== 'success'` instead of `=== 'error'`;
the operator line reads `row.operator_username` instead of `row.operator`; the timestamp line
calls `formatUnixTime(row.created_at)` instead of `formatTime(row.ts)`; the `row.detail` block
is deleted outright (the field no longer exists on `AuditRow`).

- [ ] **Step 5: Update the `keyExtractor` in `src/features/audit/AuditScreen.tsx`**

Find:

```tsx
        keyExtractor={(row) => `${row.ts}-${row.operator}-${row.action}`}
```

Replace with:

```tsx
        keyExtractor={(row) => String(row.id)}
```

Nothing else in this file changes.

- [ ] **Step 6: Type-check, lint, format**

Run: `npx tsc --noEmit`
Expected: 0 errors.

Run: `npm run lint`
Expected: 0 errors (pre-existing warning count unchanged — do not fix unrelated warnings).

Run: `npm run format:check`
Expected: clean, no diff.

- [ ] **Step 7: Commit**

```bash
git add src/api/schemas.ts src/ui/formatTime.ts src/features/audit/AuditRow.tsx src/features/audit/AuditScreen.tsx
git commit -m "feat(oc56): audit row shape matches the real gateway's AuditEntry"
```

---

## Task 2: Mock gateway — rebuild `recordAudit` and every call site to the real shape

**Files:**
- Modify: `tools/mock-gateway/src/audit.js` (full file)
- Modify: `tools/mock-gateway/src/middleware/auth.js` (the tail of `requireAuth`)
- Modify: `tools/mock-gateway/src/routes/auth.js` (the `issueSession` function's
  `state.sessions.set(...)` call)
- Modify: `tools/mock-gateway/src/routes/server.js` (5 `recordAudit` call sites)
- Modify: `tools/mock-gateway/src/routes/oracleTrigger.js` (1 call site)
- Modify: `tools/mock-gateway/src/routes/oracleStage.js` (2 call sites)
- Modify: `tools/mock-gateway/src/routes/broadcast.js` (1 call site)
- Modify: `tools/mock-gateway/src/routes/playerUnlock.js` (2 call sites)
- Modify: `tools/mock-gateway/src/routes/oracleEnabled.js` (1 call site)

**Interfaces:**
- Consumes: `AuditRow`'s real shape from Task 1 (`{ id, operator_uuid, operator_username,
  action, payload, outcome, created_at }`) — this task's whole job is making the mock's
  `recordAudit()` output match it exactly, since the mock is validated against the very same
  `AuditRowSchema` at runtime (via `StreamClient.ts` for the SSE path, and implicitly via
  whatever consumes `GET /audit`'s response on the client).
- Produces: `recordAudit({ operatorUuid, operatorUsername, action, payload, outcome })` — the
  new call signature every route file below must use (renamed from the old `{ operator, action,
  payload, outcome, detail }`).

This task does not depend on Task 1's commit and can be done independently, but both must land
on this branch before the live-verification step at the end.

- [ ] **Step 1: Rewrite `tools/mock-gateway/src/audit.js`**

Current full file:

```js
const { state } = require('./state');
const { broadcast } = require('./sse');

function recordAudit({ operator, action, payload, outcome, detail }) {
  const row = {
    ts: new Date().toISOString(),
    operator,
    action,
    payload: payload ?? {},
    outcome,
    ...(detail ? { detail } : {}),
  };
  state.auditLog.push(row);
  broadcast('audit', row);
  return row;
}

module.exports = { recordAudit };
```

Replace with:

```js
const { state } = require('./state');
const { broadcast } = require('./sse');

let nextId = 1;

function recordAudit({ operatorUuid, operatorUsername, action, payload, outcome }) {
  const row = {
    id: nextId++,
    operator_uuid: operatorUuid,
    operator_username: operatorUsername,
    action,
    payload: payload ?? {},
    outcome,
    created_at: Math.floor(Date.now() / 1000),
  };
  state.auditLog.push(row);
  broadcast('audit', row);
  return row;
}

module.exports = { recordAudit };
```

- [ ] **Step 2: Thread `operatorUuid` through `tools/mock-gateway/src/middleware/auth.js`**

Find the tail of `requireAuth` (the comment block above these lines, about cookie/bearer
precedence, is unrelated and stays exactly as-is):

```js
  req.operator = session.operator;
  req.token = token;
  next();
```

Replace with:

```js
  req.operator = session.operator;
  req.operatorUuid = session.operatorUuid;
  req.token = token;
  next();
```

- [ ] **Step 3: Store `operatorUuid` on the session in `tools/mock-gateway/src/routes/auth.js`**

Find, inside `issueSession`:

```js
  state.sessions.set(token, {
    operator: username,
    expiresAt,
    createdAt: Date.now(),
    csrfToken,
  });
```

Replace with:

```js
  state.sessions.set(token, {
    operator: username,
    operatorUuid: MOCK_OPERATOR_UUID,
    expiresAt,
    createdAt: Date.now(),
    csrfToken,
  });
```

`MOCK_OPERATOR_UUID` is already defined earlier in this file (used by the returned
`operator_uuid` field) — nothing else in `issueSession` or the rest of the file changes.

- [ ] **Step 4: Update all 5 `recordAudit` call sites in `tools/mock-gateway/src/routes/server.js`**

Find (line 11):

```js
  recordAudit({ operator: req.operator, action: 'server.start', payload: {}, outcome: 'ok' });
```

Replace:

```js
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'server.start',
    payload: {},
    outcome: 'success',
  });
```

Find (lines 28-33):

```js
  recordAudit({
    operator: req.operator,
    action: 'server.stop',
    payload: { mode, seconds, reason },
    outcome: 'ok',
  });
```

Replace:

```js
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'server.stop',
    payload: { mode, seconds, reason },
    outcome: 'success',
  });
```

Find (lines 43-48):

```js
  recordAudit({
    operator: req.operator,
    action: 'server.restart',
    payload: { seconds, reason },
    outcome: 'ok',
  });
```

Replace:

```js
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'server.restart',
    payload: { seconds, reason },
    outcome: 'success',
  });
```

Find (lines 56-62 — this is the one failure-outcome site in this file, and the one call site in
the whole mock that passes `detail`; `detail` is dropped, not renamed, since the real
`AuditEntry` has no such field):

```js
    recordAudit({
      operator: req.operator,
      action: 'server.cancel_shutdown',
      payload: {},
      outcome: 'error',
      detail: err.message,
    });
```

Replace:

```js
    recordAudit({
      operatorUuid: req.operatorUuid,
      operatorUsername: req.operator,
      action: 'server.cancel_shutdown',
      payload: {},
      outcome: 'failed',
    });
```

Find (lines 65-70):

```js
  recordAudit({
    operator: req.operator,
    action: 'server.cancel_shutdown',
    payload: {},
    outcome: 'ok',
  });
```

Replace:

```js
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'server.cancel_shutdown',
    payload: {},
    outcome: 'success',
  });
```

Find (lines 80-85):

```js
  recordAudit({
    operator: req.operator,
    action: 'server.disconnect_all',
    payload: {},
    outcome: 'ok',
  });
```

Replace:

```js
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'server.disconnect_all',
    payload: {},
    outcome: 'success',
  });
```

- [ ] **Step 5: Update the 1 call site in `tools/mock-gateway/src/routes/oracleTrigger.js`**

Find (lines 62-67):

```js
    recordAudit({
      operator: req.operator,
      action: 'oracle.trigger',
      payload: { event_id: eventId, target, dry_run: false },
      outcome: 'ok',
    });
```

Replace:

```js
    recordAudit({
      operatorUuid: req.operatorUuid,
      operatorUsername: req.operator,
      action: 'oracle.trigger',
      payload: { event_id: eventId, target, dry_run: false },
      outcome: 'success',
    });
```

- [ ] **Step 6: Update both call sites in `tools/mock-gateway/src/routes/oracleStage.js`**

Find (lines 27-32):

```js
    recordAudit({
      operator: req.operator,
      action: 'oracle.stage',
      payload: { id, dm_event: sanitized },
      outcome: 'ok',
    });
```

Replace:

```js
    recordAudit({
      operatorUuid: req.operatorUuid,
      operatorUsername: req.operator,
      action: 'oracle.stage',
      payload: { id, dm_event: sanitized },
      outcome: 'success',
    });
```

Find (lines 42-47):

```js
  recordAudit({
    operator: req.operator,
    action: 'oracle.unstage',
    payload: { id: req.params.id },
    outcome: 'ok',
  });
```

Replace:

```js
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'oracle.unstage',
    payload: { id: req.params.id },
    outcome: 'success',
  });
```

- [ ] **Step 7: Update the 1 call site in `tools/mock-gateway/src/routes/broadcast.js`**

Find (lines 23-28):

```js
  recordAudit({
    operator: req.operator,
    action: 'broadcast',
    payload: { message },
    outcome: 'ok',
  });
```

Replace:

```js
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'broadcast',
    payload: { message },
    outcome: 'success',
  });
```

- [ ] **Step 8: Update both call sites in `tools/mock-gateway/src/routes/playerUnlock.js`**

Find (lines 24-29 — the one other failure-outcome site in the mock):

```js
    recordAudit({
      operator: req.operator,
      action: 'players.2fa_unlock',
      payload: { username: trimmed },
      outcome: 'error',
    });
```

Replace:

```js
    recordAudit({
      operatorUuid: req.operatorUuid,
      operatorUsername: req.operator,
      action: 'players.2fa_unlock',
      payload: { username: trimmed },
      outcome: 'failed',
    });
```

Find (lines 32-37):

```js
  recordAudit({
    operator: req.operator,
    action: 'players.2fa_unlock',
    payload: { username: trimmed },
    outcome: 'ok',
  });
```

Replace:

```js
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'players.2fa_unlock',
    payload: { username: trimmed },
    outcome: 'success',
  });
```

- [ ] **Step 9: Update the 1 call site in `tools/mock-gateway/src/routes/oracleEnabled.js`**

Find (lines 14-19):

```js
  recordAudit({
    operator: req.operator,
    action: 'oracle.enabled',
    payload: { enabled },
    outcome: 'ok',
  });
```

Replace:

```js
  recordAudit({
    operatorUuid: req.operatorUuid,
    operatorUsername: req.operator,
    action: 'oracle.enabled',
    payload: { enabled },
    outcome: 'success',
  });
```

- [ ] **Step 10: Confirm no call site was missed**

Run: `grep -n "operator: req.operator\|outcome: 'ok'\|outcome: 'error'" tools/mock-gateway/src/routes/*.js`

Expected: no output. Any remaining hit means a call site was missed in Steps 4-9 — go back and
fix it before proceeding.

- [ ] **Step 11: Live-verify the mock gateway serves the new shape**

Run: `npm run mock-gateway` (leave it running in the background), then in a second terminal:

```bash
curl -s -c /tmp/oc56-cookies.txt -X POST http://localhost:4000/api/v1/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"matias","password":"mock","totp_code":"000000"}'
```

Expected: a JSON response containing `session_token`, `operator_uuid`, `operator_username`
(unchanged by this ticket — confirms login still works before testing the audit path).

```bash
curl -s -b /tmp/oc56-cookies.txt -X POST http://localhost:4000/api/v1/server/start
curl -s -b /tmp/oc56-cookies.txt http://localhost:4000/api/v1/audit
```

Expected: the `/audit` response is a JSON array whose most recent entry has exactly the keys
`id`, `operator_uuid`, `operator_username`, `action`, `payload`, `outcome`, `created_at` — no
`ts`, no `operator`, no `detail`. `outcome` reads `"success"`. `id` is a number. `created_at` is
a number close to the current unix timestamp in seconds (not milliseconds — if it's a
13-digit number instead of 10, Step 1's `Math.floor(Date.now() / 1000)` was not applied
correctly).

Stop the mock gateway process once confirmed.

- [ ] **Step 12: Commit**

```bash
git add tools/mock-gateway/src/audit.js tools/mock-gateway/src/middleware/auth.js tools/mock-gateway/src/routes/auth.js tools/mock-gateway/src/routes/server.js tools/mock-gateway/src/routes/oracleTrigger.js tools/mock-gateway/src/routes/oracleStage.js tools/mock-gateway/src/routes/broadcast.js tools/mock-gateway/src/routes/playerUnlock.js tools/mock-gateway/src/routes/oracleEnabled.js
git commit -m "feat(oc56): mock gateway audit rows match the real AuditEntry shape"
```

---

## Final live verification (after both tasks land)

Not a separate task — a whole-branch check once Task 1 and Task 2 are both committed, exercising
the two halves together the way an operator actually would.

- [ ] Run `npm run mock-gateway` and, in another terminal, `npx expo start --web`.
- [ ] Log in, navigate to the Auditoría screen (`Más` → `Auditoría`). Confirm existing rows
      render with a real username (not a uuid), a plausible local time (not "Invalid Date"), and
      cyan (success) styling.
- [ ] With the Auditoría screen open, trigger a mutating action from another screen (e.g. start
      the server) and confirm a new row appears live, without a manual pull-to-refresh, still
      correctly shaped.
- [ ] Trigger the one easily-reachable failure path (`players.2fa_unlock` with a username that
      doesn't match a known player alias) and confirm that row renders with danger (red)
      styling, since `outcome` is `"failed"` and the new `isError` check is `!== 'success'`.
- [ ] Check the browser console: no Zod validation warnings/errors on either the initial
      `GET /audit` fetch or the live SSE `audit` event.

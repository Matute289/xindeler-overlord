# Audit row shape fix + operator identity (OC-56) design

## What's broken

`OC-56` started as "show the operator's name in Auditoría instead of a raw uuid." Comparing this
app's `AuditRowSchema` (`src/api/schemas.ts`) against the real, deployed gateway's actual
`AuditEntry` struct (confirmed via `git show origin/main:server/src/audit.rs` in
`xindeler-zuul`) found the mismatch is much bigger than the operator field alone — 4 of the
client's 6 fields are wrong, and one doesn't exist on the real gateway at all:

| Field | Client (`AuditRowSchema`, current) | Gateway (`AuditEntry`, real) |
|---|---|---|
| identity | `operator: string` (one field) | `operator_uuid: Uuid` + `operator_username: String` (two fields) |
| time | `ts: string` (assumed ISO) | `created_at: i64` (unix seconds) |
| result | `outcome: enum('ok' \| 'error')` | `outcome: String` — real values `"success"` / `"failed"` |
| detail | `detail?: string` | does not exist |
| id | — (none) | `id: i64` |

This is the same root cause as every other cross-repo gap found this session: the client was
built against a speculative contract (or its own mock's invention) that was never checked
against the real, merged gateway source once it existed. Matías confirmed (chat, 2026-08-20):
fix the whole shape now, in this same ticket, rather than patch only the operator field and
leave the rest for a separate ticket — `AuditRow.tsx`/`AuditScreen.tsx` are already being
touched, so a partial fix just guarantees coming back.

One forward-looking note, not part of this ticket's scope: `xindeler-zuul` has unmerged local
work (`zg53`/`zg54`/`zg55`, not on `origin/main` as of this writing) that adds more `outcome`
values (a `"requested"` pre-mutation row, `RestartOutcome` variant names). `outcome` is modeled
as `z.string()`, not a closed two-value enum, specifically so that future gateway work doesn't
require another client patch — see "The fix" below.

## The fix

Purely mechanical — the real shape is fully confirmed from source, so there's no design fork,
only correct plumbing to match it.

**`src/api/schemas.ts`** — `AuditRowSchema` rewritten to the real shape:

```ts
export const AuditRowSchema = z.object({
  id: z.number(),
  operator_uuid: z.string(),
  operator_username: z.string(),
  action: z.string(),
  payload: z.record(z.string(), z.unknown()),
  outcome: z.string(),
  created_at: z.number(),
});
```

`outcome` stays a free-form string rather than `z.enum(['success', 'failed'])` — it's a Rust
`String` on the real gateway, not a closed set, and the not-yet-merged `zg53`/`54`/`55` work
already documents more values coming. `detail` is dropped outright (no real backing field, a
pure client-side invention). `id` is added (the real gateway's own durable row identity).

This same schema backs both `GET /audit` (`useAuditQuery`) and the `audit` SSE event
(`StreamClient.ts` already validates the live-pushed event against `AuditRowSchema`) — one
schema change covers both paths with no other code change needed there.

**`src/ui/formatTime.ts`** — add a sibling export, `formatUnixTime(seconds: number): string`,
same `toLocaleTimeString('es-AR', { hour12: false })` formatting as the existing `formatTime`,
just accepting epoch-seconds instead of an ISO string. `formatTime` itself is untouched — Chat
and Logs rows still get real ISO-string timestamps from their own endpoints, unaffected by this
ticket.

**`src/features/audit/AuditRow.tsx`**:
- `row.operator` → `row.operator_username`
- `formatTime(row.ts)` → `formatUnixTime(row.created_at)`
- `isError = row.outcome === 'error'` → `isError = row.outcome !== 'success'` (matches the real
  semantics — anything that isn't a clean success is worth the danger styling, without
  hardcoding a closed set of "bad" values that the string type doesn't actually have)
- the `row.detail` conditional render block is deleted — the field no longer exists

**`src/features/audit/AuditScreen.tsx`**:
- `keyExtractor`: `` `${row.ts}-${row.operator}-${row.action}` `` → `` `${row.id}` `` — the real
  gateway's own row id is a simpler and strictly more correct key than the old fragile composite

**Mock gateway** (`tools/mock-gateway`), rebuilt to genuinely exercise the real shape locally:
- `src/audit.js`'s `recordAudit()` now builds `{ id, operator_uuid, operator_username, action,
  payload, outcome, created_at }` — `id` an incrementing in-memory counter, `created_at` unix
  seconds (`Math.floor(Date.now() / 1000)`), no more `detail`.
- `middleware/auth.js` currently sets only `req.operator = session.operator` (a bare username).
  It gains `req.operatorUuid = session.operatorUuid` alongside it, so every `recordAudit()` call
  site can pass `operator_uuid: req.operatorUuid, operator_username: req.operator` instead of
  `operator: req.operator`.
- `routes/auth.js`'s `issueSession()` already has `MOCK_OPERATOR_UUID` for the login response;
  it now also stores `operatorUuid: MOCK_OPERATOR_UUID` on the session record itself, so the
  middleware above has something real to read.
- All 13 `recordAudit()` call sites across `routes/*.js` change their `outcome` literal from the
  invented `'ok'`/`'error'` to the real `'success'`/`'failed'` (11 call sites currently pass
  `'ok'`, 2 pass `'error'` — a 1:1 mechanical swap, same call sites, same success/failure logic,
  only the string literal changes).

## Out of scope

- Any change to `xindeler-zuul` (the gateway is already correct; this is a client-only fix).
- The not-yet-merged `zg53`/`zg54`/`zg55` gateway work (pre-mutation audit rows, new `outcome`
  values) — `outcome: z.string()` already tolerates whatever it eventually ships without another
  client change; no need to build against an unmerged branch.
- `OC-57` (the operator-admin screen) — unrelated, blocked on different `xindeler-zuul` tickets.
- Any visual/layout redesign of the Auditoría screen — same layout, corrected data only.

## Testing

No test runner in this repo. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus
a live pass against `npm run mock-gateway` + `npx expo start --web`: (1) Auditoría renders rows
with the operator's real username, a correctly-formatted local time, and success/failure styling
that matches each row's actual outcome; (2) triggering a mutating action (e.g. start/stop
server) while the audit screen is open shows the new row arrive live via SSE with the same
correct shape, not just on next fetch; (3) no console warnings from Zod schema validation
failures on either the initial fetch or the live SSE path.

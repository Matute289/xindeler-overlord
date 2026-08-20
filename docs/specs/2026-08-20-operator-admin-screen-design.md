# Operator-admin screen (OC-57) design

## What this builds

A superuser-only screen to manage the operator allowlist — list every operator, add one, remove
one — replacing the SSH/env-var flow `OC-48` documented as the only way to do this today. Blocked
on `xindeler-zuul`'s `ZG-48` (superuser flag) and `ZG-49` (the admin API itself), both confirmed
shipped and stable on `origin/main` as of today (re-verified fresh against source, after this
session's other recent gateway deploy, since the backlog row explicitly asked not to trust an
old read of an unmerged shape).

Per Matías's own chat direction (quoted in the backlog row): exactly one operator — his own
account (`ΑΩ`, `is_superuser: true`) — should see this screen at all. Every other operator sees
no entry point to it whatsoever, not a visible-but-disabled one, matching this app's existing
"never imply a capability that doesn't exist" convention.

## The real API (confirmed against `xindeler-zuul`'s current `origin/main` source)

`GET /admin/operators` — superuser-only (403 for a valid non-superuser session, 401 for no
session), read-only, no CSRF/step-up. Returns an array, oldest-added first:

```rust
pub struct OperatorSummary {
    pub uuid: Uuid,
    pub display_name: String,   // never null -- falls back to the uuid's own string form
    pub is_superuser: bool,
    pub totp_status: TotpStatus, // "none" | "pending" | "confirmed" (snake_case)
    pub added_at: i64,           // unix seconds
}
```

`POST /admin/operators` — CSRF + step-up. Body `{ uuid: Uuid, display_name?: String }`
(`display_name`, if present, must be non-empty and ≤128 chars once trimmed — the server itself
validates this, 400 if not). Always adds as non-superuser (promoting to superuser isn't exposed
by this API at all). **Does not trigger TOTP enrollment** — that stays CLI/SSH-only
(`enroll-operator`, `ZG-38`'s explicit "enrollment is never self-service" decision). Responses:
`204` success, `409` "operator already exists", `400` invalid `display_name`, `500` on a real DB
error.

`DELETE /admin/operators/{uuid}` — CSRF + step-up. Self-removal is rejected outright (`400`
"cannot remove your own operator access") before touching the database, so the superuser can
never lock themselves out via this screen. On success, also revokes every one of the removed
operator's active sessions and deletes their TOTP enrollment server-side — the client does
nothing extra for this, it's already handled. Responses: `204` success (including the rare
"removed but session/TOTP cleanup partially failed" case — the server still returns `204`, since
the allowlist removal itself succeeded; the finer distinction only shows up in the gateway's own
audit log, not in this response), `404` "operator not found", `400` self-removal.

## Client design — following this app's own established conventions exactly

**Route & navigation**: `app/(tabs)/operators.tsx` (thin `<Screen><OperatorsScreen /></Screen>`
wrapper), `<Tabs.Screen name="operators" options={{ href: null }} />` added to
`app/(tabs)/_layout.tsx`, same triple every other secondary screen (`Auditoría`, `Cuentas de
jugador`) already uses. In `Más` (`app/(tabs)/more.tsx`), the row linking to it is wrapped in
`{isSuperuser && <Link .../>}` — `AuthContext`'s existing `isSuperuser: boolean` field (already
real, already populated from the login response since `OC-55`) is the only gate, nothing new
needed there.

**Schema** (`src/api/schemas.ts`):

```ts
export const TotpStatusSchema = z.enum(['none', 'pending', 'confirmed']);
export const OperatorSchema = z.object({
  uuid: z.string(),
  display_name: z.string(),
  is_superuser: z.boolean(),
  totp_status: TotpStatusSchema,
  added_at: z.number(),
});
export const OperatorsResponseSchema = z.array(OperatorSchema);
```

**Read**: `getOperators()` in `readApi.ts` (`GET /api/v1/admin/operators`,
`OperatorsResponseSchema`) → `useOperatorsQuery.ts`, mirroring `usePlayersQuery.ts` exactly
(`useQuery` + `useAuthErrorRouting`). New `queryKeys.operators`.

**Write**: `addOperator(uuid, displayName, idempotencyKey?)` and `removeOperator(uuid,
idempotencyKey?)` in `writeApi.ts`, same shape as every other write method here (`POST`/`DELETE`
via `http.request`, `Idempotency-Key` header handled automatically by `httpClient.ts` — no new
plumbing needed, `DELETE` is already a supported method there). Both consumed directly through
`useDestructiveAction`, exactly like `PlayerAccountsScreen.tsx`'s `unlockPlayer2fa` call — this
hook already owns the step-up challenge/retry flow end-to-end, no new step-up code needed on the
client side.

**Screen structure** (`OperatorsScreen.tsx`): a `FlatList` (mirroring `PlayersScreen.tsx`'s
loading/error/empty states via `Empty`/`GatewayErrorEmpty`) of operator rows, plus an "Agregar
operador" affordance above the list.

- **Row** (`OperatorRow.tsx`): display name (falls back to uuid server-side, so always
  renderable), a small superuser badge when `is_superuser`, and a plain-text TOTP status label —
  `"none"` → "Sin TOTP", `"pending"` → "TOTP pendiente", `"confirmed"` → "TOTP confirmado" (three
  fixed, known values from the server's own closed Rust enum — safe to map exhaustively here,
  unlike audit's free-form `outcome`). A "Quitar" button per row, hidden entirely on the
  superuser's own row (`operator.uuid === operatorUuid` from `AuthContext`) rather than shown
  disabled — same "no entry point at all" principle the whole screen itself follows, and it
  matches the server's own self-removal rejection instead of only discovering it via a 400 after
  tapping.
- **Add flow**: a small form (uuid text input + optional display-name text input) opens
  `ConfirmByTypingSheet` with `word="ADD"` (matching this app's existing all-caps-English
  confirm-word convention — `"FIRE"`, `"ENABLE"`, `"UNLOCK"`, `"RESTART"` are the precedents, not
  a Spanish word) and a description naming the uuid being added. `display_name` is optional
  end-to-end (server allows omitting it, falls back to the uuid string) — the form doesn't force
  it, but its placeholder/helper text nudges toward filling it in, since an admin-added operator
  with no display name just becomes another raw-uuid row exactly like `OC-56` was fixing
  elsewhere. Explicit copy in the sheet's description or directly below the form: "el nuevo
  operador todavía necesita que corras `enroll-operator` por SSH para su TOTP" — the row's own
  scope note asks for this plainly stated, not implied.
- **Remove flow**: "Quitar" opens `ConfirmByTypingSheet` with `word="REMOVE"`, description naming
  the operator's display name/uuid being removed — same pattern as `PlayerAccountsScreen`'s
  unlock confirmation.
- **Errors**: no per-status-code branching anywhere in the UI — matching this app's existing,
  deliberate discipline (confirmed via `ActionError`/`GatewayErrorEmpty`, neither one branches on
  `error.status` for display, only `error.message` is shown, mirroring how audit's `outcome` is
  treated as an open string rather than a client-invented closed set). The server's own response
  bodies (`"operator already exists"`, `"cannot remove your own operator access"`, `"operator not
  found"`) become the surfaced text as-is via `ActionError` under the relevant button, exactly
  like every other write action in this app.

## Out of scope

- Promoting/demoting `is_superuser` — the real API doesn't expose it, only the DB seed/a direct
  edit can create one.
- Triggering TOTP enrollment from this screen — stays CLI/SSH-only, `ZG-38`'s explicit boundary.
- Any gateway-side change — `ZG-48`/`ZG-49` are already shipped and correct.
- Editing an existing operator's `display_name` after adding them — the real API has no route for
  it (only add/remove); out of scope until a real update route exists.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass
against `npm run mock-gateway` + `npx expo start --web`: (1) logging in as the mock's superuser
operator shows the "Operadores" row in `Más`; (2) the list renders with real display names,
superuser badges, and TOTP-status labels; (3) adding an operator (uuid + optional name) through
the full step-up-gated confirm flow succeeds and the new row appears without a manual refresh;
(4) attempting to add a uuid that already exists surfaces the server's own `"operator already
exists"` message; (5) removing a non-self operator succeeds through the same step-up-gated
confirm flow; (6) the superuser's own row has no "Quitar" button at all. The mock gateway needs
its own `admin/operators` routes added first, matching the real shape above exactly (not part of
this design doc's client-only scope, but a prerequisite the implementation plan must include, the
same way `OC-56`'s plan rebuilt the mock's audit routes).

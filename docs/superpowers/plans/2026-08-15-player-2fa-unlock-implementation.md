# Player 2FA Unlock (OC-52) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Cuentas de jugador" screen in the Más tab lets an operator type a username and unlock
that player's 2FA lock, gated by a typed confirmation and TOTP step-up — replacing Matías's current
manual-SQL workaround.

**Architecture:** One new step-up-gated write (`api.write.unlockPlayer2fa`) reusing this app's
existing `useDestructiveAction`/`ConfirmByTypingSheet`/`ActionError` machinery verbatim — the exact
same chain `StatusScreen.tsx`'s restart/stop/start buttons already use. The mock gateway gains a
matching route that deliberately mirrors the real gateway's collapsed error shape (confirmed tonight
against `xindeler-zuul`'s real, merged `players.rs`): success or one generic error, nothing in
between.

**Tech Stack:** Existing write-API/step-up infrastructure — no new dependencies.

## Global Constraints

- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner. Verification is `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, plus a
  live pass covering BOTH the success path and the generic-error path — this ticket's entire design
  point is the collapsed error shape, so a happy-path-only live pass does not satisfy this ticket.
- The real gateway (`xindeler-zuul`, confirmed against its actual merged source tonight) returns
  `204 No Content` on success, and a single generic `502`/plain-text body for every failure mode from
  `xindeler-auth`'s side (not-found, not-locked, or a real failure are all indistinguishable). Do not
  build any UI branch that pretends to distinguish these — the backend doesn't.
- `MAX_USERNAME_LEN` is `128` on the real gateway (`players.rs`) — the mock enforces the same bound.

---

### Task 1: Write API + mock gateway route + contract doc

**Files:**
- Modify: `src/api/writeApi.ts`
- Create: `tools/mock-gateway/src/routes/playerUnlock.js`
- Modify: `tools/mock-gateway/server.js`
- Modify: `docs/reference/gateway-api-contract.md`

**Interfaces:**
- Consumes: `http.request` (already exists, `createHttpClient`); `requireAuth`/`requireCsrf`/
  `requireStepUp` (already exist, mock middleware); `recordAudit`/`sendError` (already exist, mock
  helpers); `players` fixture array (already exists, `tools/mock-gateway/src/fixtures.js`, shape
  `{ alias, uuid }[]`).
- Produces: `api.write.unlockPlayer2fa(username: string, stepUpCode: string, idempotencyKey?: string):
  Promise<void>` — consumed by Task 2's `PlayerAccountsScreen.tsx`. `POST
  /api/v1/players/2fa/unlock` on the mock — consumed by Task 2's live verification.

- [ ] **Step 1: Add `unlockPlayer2fa` to `src/api/writeApi.ts`**

Read the current file first (confirm `disconnectAll`/`cancelShutdown`'s exact shape still matches —
both take `(stepUpCode, idempotencyKey?)`, body `{}`, and return `Promise<{ok: true}>` via
`OkResponseSchema`). Add this new method to the object `createWriteApi` returns, right after
`disconnectAll`:

```ts
    unlockPlayer2fa(username: string, stepUpCode: string, idempotencyKey?: string) {
      return http.request<void>(
        '/api/v1/players/2fa/unlock',
        { method: 'POST', body: { username }, stepUpCode, idempotencyKey },
      );
    },
```

No `OkResponseSchema` — the real gateway returns `204` with no body (confirmed against
`xindeler-zuul`'s real `players.rs` tonight), and `httpClient.ts`'s `request()` already short-circuits
a `204` response to `return undefined as T` before any schema would run — passing `<void>` explicitly
as the generic (rather than omitting it and letting TypeScript infer `unknown`) is what makes the
method's own return type `Promise<void>` without a cast. No new import needed.

- [ ] **Step 2: Write `tools/mock-gateway/src/routes/playerUnlock.js`**

```js
const express = require('express');
const { sendError } = require('../errors');
const { recordAudit } = require('../audit');
const { players } = require('../fixtures');

const router = express.Router();
const MAX_USERNAME_LEN = 128;

router.post('/', (req, res) => {
  const { username } = req.body || {};
  const trimmed = typeof username === 'string' ? username.trim() : '';
  if (!trimmed) {
    return sendError(res, 400, 'invalid_body', 'username must not be empty');
  }
  if (trimmed.length > MAX_USERNAME_LEN) {
    return sendError(res, 400, 'invalid_body', 'username is too long');
  }
  // Mirrors the real gateway's collapsed error shape (confirmed against xindeler-zuul's real
  // players.rs tonight): everything that isn't a known player alias becomes the same generic
  // 502, matching the real gateway's own inability to distinguish "not found" from "not locked"
  // from "auth service down" — this mock does not invent a distinction the real backend can't make.
  const known = players.some((p) => p.alias.toLowerCase() === trimmed.toLowerCase());
  if (!known) {
    recordAudit({
      operator: req.operator,
      action: 'players.2fa_unlock',
      payload: { username: trimmed },
      outcome: 'failed',
    });
    return sendError(res, 502, 'gateway_error', 'failed to reach the auth service');
  }
  recordAudit({
    operator: req.operator,
    action: 'players.2fa_unlock',
    payload: { username: trimmed },
    outcome: 'success',
  });
  res.status(204).end();
});

module.exports = router;
```

(`players` from `../fixtures` is the existing fixture array — using its real aliases as
"known/unlockable" and anything else as "not found" gives Task 2's live-verification pass real,
deterministic success and failure cases with no new fixture data.)

- [ ] **Step 3: Wire the new route into `tools/mock-gateway/server.js`**

Read the current file first (confirm `playersRoutes`'s existing mount and `requireCsrf`/
`requireStepUp`'s imports still match — both already exist from tonight's earlier tickets). Add the
import near the other route imports, after `const playersRoutes = require('./src/routes/players');`:

```js
const playerUnlockRoutes = require('./src/routes/playerUnlock');
```

Add a NEW, separate mount right after the existing `/api/v1/players` line — do NOT add this route
inside `players.js`/`playersRoutes` (that router only has `GET /` and is mounted with `requireAuth`
alone; this new action needs `requireCsrf` + `requireStepUp` too, so it gets its own mount, matching
how `oracle/stage`/`oracle/trigger`/`oracle/enabled` are each already separately mounted rather than
folded into a shared router with mixed protection levels):

```js
app.use('/api/v1/players/2fa/unlock', requireAuth, requireCsrf, requireStepUp, playerUnlockRoutes);
```

- [ ] **Step 4: Document the new endpoint in `docs/reference/gateway-api-contract.md`**

Read the current file's section numbering first (it was §8 as of tonight's earlier OC-45 work — it
may have shifted since; use whatever the actual current highest section number is). Add a new section
after the current highest-numbered section, matching §4 Lifecycle's exact table format and
"all step-up authenticated" header convention:

```
## <N>. Player account administration

**Confirmed 2026-08-15 against the real `xindeler-zuul` source (`server/src/players.rs`), not just
speculated — this section describes what was actually verified, not a guess.**

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/v1/players/2fa/unlock` | `{ username }` → `204` on success |

Every non-`204` response is a single generic failure — the real gateway collapses "username not
found," "account exists but isn't locked," and "the auth service is unreachable" into the same `502`
with a hardcoded message (`players.rs`'s own `Unlock2faError::Failed` branch). There is no `code`
field or other distinguishing detail; the client cannot and must not pretend to tell these cases
apart.

**Client rule:** this endpoint needs a confirm sheet that requires typing `UNLOCK`, plus the standard
step-up TOTP prompt — same bar as `/server/restart`/immediate `/server/stop`.
```

Renumber whatever section currently follows this point by one, if the doc's sections are sequential —
check the current file to confirm the exact next-section boundary before making this edit.

- [ ] **Step 5: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 6: Commit**

```bash
git add src/api/writeApi.ts tools/mock-gateway/src/routes/playerUnlock.js tools/mock-gateway/server.js docs/reference/gateway-api-contract.md
git commit -m "feat(oc52): unlockPlayer2fa write API + mock gateway route"
```

---

### Task 2: Screen + navigation wiring + live verification + backlog

**Files:**
- Create: `app/(tabs)/player-accounts.tsx`
- Create: `src/features/playerAccounts/PlayerAccountsScreen.tsx`
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `app/(tabs)/more.tsx`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `api.write.unlockPlayer2fa` (Task 1); `useDestructiveAction`/`ConfirmByTypingSheet`/
  `ActionError`/`Button`/`TextField` (all already exist, unchanged by this ticket).
- Produces: nothing consumed by a later task — end of this plan's chain.

- [ ] **Step 1: Write `app/(tabs)/player-accounts.tsx`**

```tsx
import { PlayerAccountsScreen } from '@/features/playerAccounts/PlayerAccountsScreen';
import { Screen } from '@/ui/Screen';

export default function PlayerAccountsRoute() {
  return (
    <Screen>
      <PlayerAccountsScreen />
    </Screen>
  );
}
```

- [ ] **Step 2: Write `src/features/playerAccounts/PlayerAccountsScreen.tsx`**

```tsx
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import { ActionError } from '@/features/connectivity/ActionError';
import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { Button } from '@/ui/Button';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { TextField } from '@/ui/TextField';
import { fonts } from '@/ui/theme';

const SUCCESS_MESSAGE_MS = 3000;

export function PlayerAccountsScreen() {
  const api = useApi();
  const [username, setUsername] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const unlockAction = useDestructiveAction<void>((code, idempotencyKey) =>
    api.write.unlockPlayer2fa(username.trim(), code, idempotencyKey),
  );

  async function handleConfirm() {
    setConfirming(false);
    const target = username.trim();
    const result = await unlockAction.run();
    // `run()` resolves `T | null` — `T` is `void` here, so a successful call resolves
    // `undefined`, and only a failed/cancelled call resolves the literal `null`. Checking
    // `!== null` (not `!== undefined`) is what actually distinguishes the two at runtime.
    if (result !== null) {
      setSuccessMessage(`Listo — 2FA desbloqueado para ${target}.`);
      setTimeout(() => setSuccessMessage(null), SUCCESS_MESSAGE_MS);
      setUsername('');
    }
  }

  return (
    <View className="gap-4 px-6 pt-6">
      <Text
        className="text-xl text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.bold }}
      >
        Cuentas de jugador
      </Text>
      <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
        Desbloqueá la cuenta de un jugador que se quedó afuera por códigos de 2FA incorrectos.
      </Text>
      <TextField
        label="Nombre de usuario"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button
        label="Desbloquear 2FA"
        onPress={() => setConfirming(true)}
        loading={unlockAction.pending}
        disabled={username.trim().length === 0}
      />
      {unlockAction.error && <ActionError error={unlockAction.error} />}
      {successMessage && (
        <Text className="text-sm text-accent-cyan dark:text-night-accent-cyan">
          {successMessage}
        </Text>
      )}
      <ConfirmByTypingSheet
        visible={confirming}
        word="UNLOCK"
        description={`Esto va a desbloquear la cuenta de "${username.trim()}" — no hay confirmación previa del jugador.`}
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}
```

- [ ] **Step 3: Register the route in `app/(tabs)/_layout.tsx`**

Read the current file first (confirm the `href: null` block still matches). Change:

```tsx
              <Tabs.Screen name="audit" options={{ href: null }} />
              <Tabs.Screen name="oracle-composer" options={{ href: null }} />
              <Tabs.Screen name="oracle-trigger" options={{ href: null }} />
              <Tabs.Screen name="oracle-chat" options={{ href: null }} />
```

to:

```tsx
              <Tabs.Screen name="audit" options={{ href: null }} />
              <Tabs.Screen name="player-accounts" options={{ href: null }} />
              <Tabs.Screen name="oracle-composer" options={{ href: null }} />
              <Tabs.Screen name="oracle-trigger" options={{ href: null }} />
              <Tabs.Screen name="oracle-chat" options={{ href: null }} />
```

- [ ] **Step 4: Add the entry-point row in `app/(tabs)/more.tsx`**

Read the current file first (39 lines, shown below — confirm it still matches, note it now includes
tonight's earlier `PushNotificationsSettings` addition):

```tsx
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { EnvironmentSwitcher } from '@/features/environment/EnvironmentSwitcher';
import { PushNotificationsSettings } from '@/features/pushNotifications/PushNotificationsSettings';
import { Button } from '@/ui/Button';
import { Screen } from '@/ui/Screen';
import { fonts, useTheme } from '@/ui/theme';

export default function MoreScreen() {
  const { logout, operator } = useAuth();
  const { colors } = useTheme();

  return (
    <Screen>
      <View className="px-6 pt-6">
        <Link href="/audit" asChild>
          <Pressable
            accessibilityRole="button"
            className="flex-row items-center justify-between rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark"
          >
            <Text
              className="text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.semibold }}
            >
              Auditoría
            </Text>
            <Ionicons name="chevron-forward-outline" color={colors.textMuted} size={18} />
          </Pressable>
        </Link>
        <PushNotificationsSettings />
      </View>
      <EnvironmentSwitcher />
      <View className="mt-8 gap-2 px-6">
        <Text className="text-center text-sm text-steel-muted dark:text-night-steel-muted">
          Conectado como {operator}
        </Text>
        <Button label="Cerrar sesión" onPress={() => logout()} />
      </View>
    </Screen>
  );
}
```

Change to (adds a second `Link` row for "Cuentas de jugador" directly below "Auditoría", inside the
same wrapping `View`, before `<PushNotificationsSettings />`):

```tsx
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { EnvironmentSwitcher } from '@/features/environment/EnvironmentSwitcher';
import { PushNotificationsSettings } from '@/features/pushNotifications/PushNotificationsSettings';
import { Button } from '@/ui/Button';
import { Screen } from '@/ui/Screen';
import { fonts, useTheme } from '@/ui/theme';

export default function MoreScreen() {
  const { logout, operator } = useAuth();
  const { colors } = useTheme();

  return (
    <Screen>
      <View className="px-6 pt-6">
        <Link href="/audit" asChild>
          <Pressable
            accessibilityRole="button"
            className="flex-row items-center justify-between rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark"
          >
            <Text
              className="text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.semibold }}
            >
              Auditoría
            </Text>
            <Ionicons name="chevron-forward-outline" color={colors.textMuted} size={18} />
          </Pressable>
        </Link>
        <Link href="/player-accounts" asChild>
          <Pressable
            accessibilityRole="button"
            className="mt-2 flex-row items-center justify-between rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark"
          >
            <Text
              className="text-steel-light dark:text-night-steel-light"
              style={{ fontFamily: fonts.semibold }}
            >
              Cuentas de jugador
            </Text>
            <Ionicons name="chevron-forward-outline" color={colors.textMuted} size={18} />
          </Pressable>
        </Link>
        <PushNotificationsSettings />
      </View>
      <EnvironmentSwitcher />
      <View className="mt-8 gap-2 px-6">
        <Text className="text-center text-sm text-steel-muted dark:text-night-steel-muted">
          Conectado como {operator}
        </Text>
        <Button label="Cerrar sesión" onPress={() => logout()} />
      </View>
    </Screen>
  );
}
```

(`mt-2` on the new row's `className` gives it a small gap from the `Auditoría` row above it, matching
how `<PushNotificationsSettings />` already spaces itself from its own preceding sibling.)

- [ ] **Step 5: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 6: Live verification**

Prerequisite: `npm run mock-gateway` running, `npx expo start --web` running, logged in (`matias`/mock,
TOTP `000000`).

1. Navigate to `/more`, confirm "Cuentas de jugador" renders below "Auditoría" with the same visual
   style, tap it, confirm it navigates to `/player-accounts` and renders the screen.
2. Confirm "Desbloquear 2FA" is disabled while the username field is empty, enabled once text is
   typed.
3. **Success path**: type a real fixture player alias (check `tools/mock-gateway/src/fixtures.js`'s
   `players` array for an exact current alias, e.g. `Kaelith`), tap "Desbloquear 2FA", confirm the
   `ConfirmByTypingSheet` appears and the button stays disabled until exactly `UNLOCK` is typed, confirm
   it, confirm the TOTP step-up prompt appears and blocks until a code is entered, enter `000000`,
   confirm the request succeeds and the brief "Listo — 2FA desbloqueado para `<alias>`." message
   appears and then clears itself after ~3s, and confirm the username field cleared. Inspect the actual
   network request via devtools: confirm it's `POST /api/v1/players/2fa/unlock`, carries a valid
   `x-csrf-token` header and an `X-Ops-Totp` header, and the response is `204` with an empty body.
4. **Generic-error path**: type a username that is NOT in the fixtures (e.g. `nombre_inventado`), go
   through the same confirm+step-up flow, and confirm the request fails with a rendered error message
   (via `ActionError`) rather than silently succeeding or crashing — this is the ticket's core design
   point (the client cannot and must not claim to know *why* it failed). Inspect the network request to
   confirm it received a `502` from the mock.
5. Confirm the mock's audit log picked up both attempts — navigate to `/audit` and confirm two new
   entries with `action: "players.2fa_unlock"`, one `outcome: "success"` and one `outcome: "failed"`,
   with no extra client-side code needed for this (the mock's own `recordAudit` call in Task 1 already
   covers it).

- [ ] **Step 7: Update `docs/backlog.md`'s OC-52 row and the Known Blockers table**

Change OC-52's row status from `🅿️` to `✅`. Describe: the confirmation tonight that both real
blockers cleared (`xindeler-auth`'s Fase L in production, `xindeler-zuul`'s `ZG-45` merged — cite
having read the real `players.rs` directly, not just its backlog row), the corrected design (the
originally-planned three-way error split doesn't exist — the real gateway only distinguishes success
from one generic failure, and why), the reused `useDestructiveAction`/`ConfirmByTypingSheet` pattern
(no new primitives), and the live verification performed (all 5 checks, including the audit-log
cross-check). Match the detailed style of the existing OC-4x/5x rows.

Also remove the now-fully-resolved blocker row from the "Known blockers & dependencies" table (the
one reading `xindeler-zuul has no gateway route forwarding to xindeler-auth's POST
/2fa/admin/unlock...` with owner `xindeler-zuul (tracked as ZG-45, PR #46)`) — both halves are done,
this row no longer describes a real blocker.

- [ ] **Step 8: Commit**

```bash
git add "app/(tabs)/player-accounts.tsx" src/features/playerAccounts/PlayerAccountsScreen.tsx "app/(tabs)/_layout.tsx" "app/(tabs)/more.tsx" docs/backlog.md
git commit -m "feat(oc52): player 2FA unlock screen, wired into Más"
```

---

## Self-Review

**Spec coverage:** The corrected collapsed-error-shape design (both stated in the design doc and
mechanically enforced by the mock's own single-error-branch route), the reused
`useDestructiveAction`/`ConfirmByTypingSheet`/`ActionError` chain (no new primitives), the `204`/no-body
success contract matched from the start, the no-new-audit-mechanism decision (server records it
automatically), and the live verification plan (both success and error paths, plus the audit-log
cross-check) are all covered across the two tasks. "Out of scope" items (a player-account directory,
distinguishing not-found from not-locked, a new client-side audit mechanism) — no task builds any of
them. ✅

**Placeholder scan:** No TBD/TODO — full literal code throughout, including the exact live-verification
sequence and the exact fixture-alias-based success/failure test cases.

**Type consistency:** `unlockPlayer2fa(username: string, stepUpCode: string, idempotencyKey?:
string): Promise<void>` (Task 1) is consumed identically by Task 2's `PlayerAccountsScreen.tsx`
(`api.write.unlockPlayer2fa(username.trim(), code, idempotencyKey)` inside `useDestructiveAction<void>`'s
callback). The `result !== null` check in `handleConfirm()` is explicitly reasoned through in a code
comment (not left as an unverified assumption) — `useDestructiveAction<T>.run()` resolves `T | null`,
`T` is `void` here, so a successful call resolves the literal `undefined` and only failure/cancellation
resolves the literal `null`; `!== null` is therefore the correct comparison, `!== undefined` would be
wrong (a successful `void` result IS `undefined`, so that comparison would treat success as failure).
The mock's `POST /api/v1/players/2fa/unlock` path (Task 1) matches exactly what Task 1's own
`writeApi.ts` method calls and what Task 2's live verification inspects via devtools.

# Step-up session mechanism (OC-54) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the client's per-request `X-Ops-Totp` header step-up mechanism (which the real, already-deployed `xindeler-zuul` gateway never reads) with the real, session-scoped mechanism: `POST /api/v1/step-up` opens a 5-minute step-up window on the session; every destructive route then reads that window server-side, with no header on the write itself.

**Architecture:** `useDestructiveAction.run()` gets a TOTP code from the existing `useStepUpAuth()` prompt/cache exactly as today, but now spends it by calling the new `api.auth.stepUp(code)` before invoking the caller's write closure — which no longer receives or forwards a code at all. `writeApi.ts`'s 10 step-up-gated methods drop their `stepUpCode` parameter; `httpClient.ts` drops the `X-Ops-Totp` header entirely (dead code once the header is never read). The mock gateway is rewritten to genuinely mirror the same session-scoped model (a `steppedUpUntil` timestamp on the session, set by a new mock route), not just to stop sending a header nobody asked for.

**Tech Stack:** Expo/React Native (TypeScript) client; `tools/mock-gateway` (plain JS, Express) as the only backend available to develop and test against today.

## Global Constraints

- No default `React` imports anywhere in this repo.
- Prettier: single quotes, semicolons, trailing commas, 100-column wrap. Run `npx prettier --write <file>` on any file that fails `npm run format:check` — do not hand-wrap lines to guess at its output.
- `@/` resolves to `src/`.
- No test runner exists. Verification is `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, plus a live pass against `npm run mock-gateway` + `npx expo start --web`, driven with the `claude-in-chrome` browser tools (log in `matias`/`mock`, TOTP `000000`).
- `useDestructiveAction<T>.run()` resolves `T | null` — `null` on failure/cancellation, the real (possibly `undefined`, for `T = void`) value on success. Any code checking the result must compare `!== null`, never `!== undefined`.
- Every mutating `httpClient.request()` call already attaches `x-csrf-token` automatically (OC-53) — no task in this plan needs to touch CSRF plumbing.
- This ticket fixes the step-up **mechanism** only. It does not revisit *which* actions require step-up (e.g. `oracle/stage`'s already-flagged, separately-parked mismatch with the real gateway) — every write that sends a step-up code today keeps sending one through the new mechanism, unchanged in scope.
- Full background and the real-gateway source citations (`login.rs`, `session.rs`, `lifecycle.rs`, `web.rs`) that justify every change in this plan live in `docs/specs/2026-08-15-step-up-session-mechanism-design.md` — read it first if anything below needs more context than what's written here.

---

### Task 1: Client — session-scoped step-up call, `useDestructiveAction` rewrite, all call sites

**Files:**
- Modify: `src/api/httpClient.ts`
- Modify: `src/api/authApi.ts`
- Modify: `src/features/status/useDestructiveAction.ts`
- Modify: `src/api/writeApi.ts`
- Modify: `src/features/status/StatusScreen.tsx`
- Modify: `src/features/oracle/OracleComposerScreen.tsx`
- Modify: `src/features/oracle/OracleDryRunScreen.tsx`
- Modify: `src/features/oracle/OracleEventsScreen.tsx`
- Modify: `src/features/playerAccounts/PlayerAccountsScreen.tsx`

**Interfaces:**
- Produces: `api.auth.stepUp(totpCode: string): Promise<void>` — `POST /api/v1/step-up`. Task 2's mock-gateway route implements this contract.
- Produces: `useDestructiveAction<T>(call: (idempotencyKey: string) => Promise<T>, options?: { forceFreshStepUp?: boolean })` — the `call` closure signature loses its first (`stepUpCode`) parameter. This is the one breaking interface change in this task; every call site in this task updates to match in the same commit, so the branch never has a broken intermediate state.
- Consumes: nothing from Task 2 — this task is self-contained and does not require the mock-gateway changes to typecheck or lint clean (only the live-verification pass in Task 2 requires both tasks' code present).

This task must land as a single commit (or a tightly-sequenced set of commits that never leave the tree in a non-compiling state) — `writeApi.ts` losing `stepUpCode` and the 5 screens' call sites dropping the `code` argument are two halves of the same interface change; landing one without the other does not typecheck.

- [ ] **Step 1: Remove the dead `X-Ops-Totp` header from `httpClient.ts`**

The real gateway never reads this header on any route (confirmed against `login.rs`/`lifecycle.rs`) — it's being replaced by the session-scoped call added in Step 2, not narrowed or renamed.

In `src/api/httpClient.ts`, remove the `stepUpCode` field from `RequestOptions`:

```ts
type RequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  // When provided, used INSTEAD of `deps.generateIdempotencyKey()` — safety-review finding 6,
  // 2026-08-14. Without this, a caller that needs to send the same logical mutation twice (e.g.
  // `useDestructiveAction`'s retry-once-on-403 step-up flow) has no way to make the two attempts
  // share one idempotency key, since a fresh one was generated inside every `request()` call.
  idempotencyKey?: string;
};
```

And remove the header spread inside `request()` (the last entry in the `headers` object):

```ts
      const headers: Record<string, string> = {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(authHeader ?? {}),
        ...(csrfHeader ?? {}),
        ...(method !== 'GET'
          ? { 'Idempotency-Key': options.idempotencyKey ?? deps.generateIdempotencyKey() }
          : {}),
      };
```

Nothing else in this file changes.

- [ ] **Step 2: Add `api.auth.stepUp()` to `authApi.ts`**

Add this method to the object returned by `createAuthApi` in `src/api/authApi.ts`, after the existing `logout()` method:

```ts
    // Session-scoped step-up (OC-54) — establishes a 5-minute window on the CURRENT session
    // during which destructive routes (gateway-api-contract.md §4/§5) allow writes with no extra
    // header. Bare `/api/v1/step-up`, deliberately NOT nested under `/api/v1/auth/` like this
    // file's other methods — the real xindeler-zuul route (`web.rs`) is bare `/step-up`,
    // confirmed directly against its source. `204` on success, no body.
    stepUp(totpCode: string): Promise<void> {
      return http.request('/api/v1/step-up', { method: 'POST', body: { totp_code: totpCode } });
    },
```

The full file after this change:

```ts
import type { createHttpClient } from './httpClient';
import { LoginResponseSchema, TotpResponseSchema } from './schemas';

type HttpClient = ReturnType<typeof createHttpClient>;

export function createAuthApi(http: HttpClient) {
  return {
    login(username: string, password: string) {
      return http.request(
        '/api/v1/auth/login',
        { method: 'POST', body: { username, password } },
        LoginResponseSchema,
      );
    },

    totp(challengeId: string, code: string) {
      return http.request(
        '/api/v1/auth/totp',
        { method: 'POST', body: { challenge_id: challengeId, code } },
        TotpResponseSchema,
      );
    },

    // Currently unwired — no caller anywhere in this app. Whoever wires this must call
    // sessionStorage.save({...}) with BOTH the new `token` and the new `csrfToken` from the
    // response (the mock's /refresh now rotates both), or subsequent writes will 403 with a
    // stale CSRF token.
    refresh() {
      return http.request('/api/v1/auth/refresh', { method: 'POST' }, TotpResponseSchema);
    },

    logout(): Promise<void> {
      return http.request('/api/v1/auth/logout', { method: 'POST' });
    },

    // Session-scoped step-up (OC-54) — establishes a 5-minute window on the CURRENT session
    // during which destructive routes (gateway-api-contract.md §4/§5) allow writes with no extra
    // header. Bare `/api/v1/step-up`, deliberately NOT nested under `/api/v1/auth/` like this
    // file's other methods — the real xindeler-zuul route (`web.rs`) is bare `/step-up`,
    // confirmed directly against its source. `204` on success, no body.
    stepUp(totpCode: string): Promise<void> {
      return http.request('/api/v1/step-up', { method: 'POST', body: { totp_code: totpCode } });
    },
  };
}
```

(`totp_code` — snake_case body key — matches the real gateway's `StepUpRequest { totp_code: String }` and this file's own existing convention, e.g. `totp()`'s `challenge_id`.)

- [ ] **Step 3: Rewrite `useDestructiveAction.ts`**

Replace the full contents of `src/features/status/useDestructiveAction.ts` with:

```ts
import * as Crypto from 'expo-crypto';
import { useState } from 'react';

import { isApiError } from '@/api';
import { useApi } from '@/api/ApiContext';
import { isStepUpCancelled, useStepUpAuth } from '@/auth/StepUpContext';

export function useDestructiveAction<T>(
  call: (idempotencyKey: string) => Promise<T>,
  // Additive, opt-in — every existing call site omits this and keeps behaving exactly as before
  // (cached step-up code reused when still fresh). `forceFreshStepUp` exists for actions
  // consequential enough that they must never silently ride a step-up obtained for a DIFFERENT,
  // earlier action — OC-34's Fire is the first such action: it's typically invoked seconds after
  // a dry-run that just populated the step-up cache, and without this option Fire would almost
  // always skip a fresh TOTP prompt, collapsing its intended "step-up AND typing FIRE" double
  // gate down to just the typing.
  options?: { forceFreshStepUp?: boolean },
) {
  const api = useApi();
  const { requestStepUp } = useStepUpAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const forceFreshStepUp = options?.forceFreshStepUp ?? false;

  // Returns the call's resolved value on success, `null` on failure or a cancelled step-up —
  // callers that need to react to success (e.g. a transient confirmation) can't reliably read the
  // `error` state right after `await run()` resolves, since a closure captured before the call
  // still sees the pre-call render's value. Returning `T` rather than a bare `true` also keeps the
  // response body reachable: ORACLE staging's `{ loaded, sanitized, diff }` is the operator's only
  // signal that a staged event failed to parse server-side, or that the gateway clamped a value.
  async function run(): Promise<T | null> {
    setPending(true);
    setError(null);
    // One idempotency key per logical operator intent, generated once here and reused across
    // BOTH `call()` attempts below — safety-review finding 6, 2026-08-14. Without this, the
    // retry-on-403 branch's second `call()` would go through `httpClient.request()` independently
    // and mint its own fresh key (every call previously did), so the gateway would see the retry
    // as a distinct operation rather than a retry of the same one. Mostly harmless for
    // stop/restart/cancel_shutdown/disconnect_all (idempotent-ish by nature), but a duplicate
    // `start` sent while the gateway is mid-orchestration from the first attempt is a real risk.
    const idempotencyKey = Crypto.randomUUID();
    try {
      const code = await requestStepUp(forceFreshStepUp ? { forceFresh: true } : undefined);
      // OC-54: the real gateway (xindeler-zuul) is session-scoped, not header-scoped — a TOTP
      // code only means anything once it's been exchanged for a step-up WINDOW via this call.
      // The destructive `call()` below sends no code at all; the gateway reads session state.
      // This runs on EVERY `run()`, even when `requestStepUp()` returned a cached (not freshly
      // prompted) code — the client-side 90s cache and the server-side 5-minute window are two
      // different things, and re-establishing the window costs one extra request but keeps the
      // window fresh for exactly as long as the write that's about to use it needs it to be.
      await api.auth.stepUp(code);
      let result: T;
      try {
        result = await call(idempotencyKey);
      } catch (err) {
        // `status === 403` (not a specific error code) is what actually distinguishes "no
        // current step-up window" against BOTH the mock (JSON `step_up_required` envelope) and
        // the real gateway (plain-text "step-up required" body, no parseable code at all) — the
        // HTTP status survives either shape. A CSRF-related 403 would also trigger one wasted
        // retry here before its real error surfaces; accepted, since the retry is capped at one
        // attempt and every write already requires a valid CSRF header to reach this point.
        if (isApiError(err) && err.status === 403) {
          const freshCode = await requestStepUp({ forceFresh: true });
          await api.auth.stepUp(freshCode);
          result = await call(idempotencyKey);
        } else {
          throw err;
        }
      }
      return result;
    } catch (err) {
      if (err instanceof Error && !isStepUpCancelled(err)) {
        setError(err);
      }
      // A cancelled step-up prompt is a deliberate operator choice, not a failure — no error
      // state, the action button just goes back to idle.
      return null;
    } finally {
      setPending(false);
    }
  }

  // Additive, opt-in — existing callers never call this and are unaffected. Exists for consumers
  // whose success/failure state can outlive the action itself in a way the operator can act on
  // independently of `run()`: OC-34's Fire error otherwise survives a `clearResult()` and renders
  // underneath a brand-new, unrelated dry-run card, asserting something untrue about the current
  // preview (the exact class of bug OC-32/33's final review fixed once already for the dry-run's
  // own `triggerAction`).
  function reset() {
    setError(null);
  }

  return { run, pending, error, reset };
}
```

Note what's gone: the `STEP_UP_ERROR_CODES` constant (no longer needed — the retry check is now a bare status comparison) and the `stepUpCode`/`freshCode` values ever being passed into `call(...)`.

- [ ] **Step 4: Drop `stepUpCode` from the 10 step-up-gated methods in `writeApi.ts`**

Replace the full contents of `src/api/writeApi.ts` with:

```ts
import { z } from 'zod';

import type { createHttpClient } from './httpClient';
import type { DmEvent, OracleTarget } from './schemas';
import {
  StageOracleEventResponseSchema,
  OracleTriggerResponseSchema,
  OracleEnabledResponseSchema,
} from './schemas';

type HttpClient = ReturnType<typeof createHttpClient>;

// `z.literal(true)` (not `z.boolean()`) is deliberate — safety-review finding 3, 2026-08-14. A
// bare `z.boolean()` validates `{ ok: false }` just as happily as `{ ok: true }`, so a `200 { ok:
// false }` response would pass schema validation and `useDestructiveAction.run()` (which treats
// any non-throwing resolution as success) would report success for a call the gateway actually
// rejected. Requiring the literal makes an `ok: false` response fail validation and throw an
// `invalid_response` `ApiError`, correctly surfacing as a real error instead of silently reporting
// success (this is exactly the failure mode OC-26's own "Desconectados" confirmation message would
// be vulnerable to).
const OkResponseSchema = z.object({ ok: z.literal(true) });

export function createWriteApi(http: HttpClient) {
  return {
    startServer(idempotencyKey?: string) {
      return http.request(
        '/api/v1/server/start',
        { method: 'POST', body: {}, idempotencyKey },
        OkResponseSchema,
      );
    },

    stopServer(
      body: { mode: 'graceful' | 'immediate'; seconds?: number; reason?: string },
      idempotencyKey?: string,
    ) {
      return http.request(
        '/api/v1/server/stop',
        { method: 'POST', body, idempotencyKey },
        OkResponseSchema,
      );
    },

    restartServer(body: { seconds: number; reason?: string }, idempotencyKey?: string) {
      return http.request(
        '/api/v1/server/restart',
        { method: 'POST', body, idempotencyKey },
        OkResponseSchema,
      );
    },

    cancelShutdown(idempotencyKey?: string) {
      return http.request(
        '/api/v1/server/cancel_shutdown',
        { method: 'POST', body: {}, idempotencyKey },
        OkResponseSchema,
      );
    },

    disconnectAll(idempotencyKey?: string) {
      return http.request(
        '/api/v1/server/disconnect_all',
        { method: 'POST', body: {}, idempotencyKey },
        OkResponseSchema,
      );
    },

    unlockPlayer2fa(username: string, idempotencyKey?: string) {
      return http.request<void>('/api/v1/players/2fa/unlock', {
        method: 'POST',
        body: { username },
        idempotencyKey,
      });
    },

    broadcastMessage(message: string) {
      return http.request(
        '/api/v1/broadcast',
        { method: 'POST', body: { message } },
        OkResponseSchema,
      );
    },

    registerPushToken(expoPushToken: string, platform: 'ios' | 'android'): Promise<void> {
      return http.request('/api/v1/push/register', {
        method: 'POST',
        body: { expo_push_token: expoPushToken, platform },
      });
    },

    unregisterPushToken(expoPushToken: string): Promise<void> {
      return http.request('/api/v1/push/unregister', {
        method: 'POST',
        body: { expo_push_token: expoPushToken },
      });
    },

    stageOracleEvent(id: string, dmEvent: DmEvent, idempotencyKey?: string) {
      return http.request(
        '/api/v1/oracle/stage',
        { method: 'POST', body: { id, dm_event: dmEvent }, idempotencyKey },
        StageOracleEventResponseSchema,
      );
    },

    // `dryRun: true` is the TypeScript literal type, not `boolean` — deliberate, final-review
    // finding 3. The plan's constraint is "no code path constructs a trigger request without
    // `dry_run: true` hardcoded"; a `boolean` parameter is exactly such a path, one keystroke
    // away from flipping the most dangerous parameter in the app with the compiler silent.
    // Narrowed to the literal, any call site passing `false` is a compile error. OC-34 (fire)
    // adds a separate `fireOracleEvent` method below instead of widening this one — see its
    // comment.
    triggerOracleEvent(
      eventId: string,
      target: OracleTarget,
      dryRun: true,
      idempotencyKey?: string,
    ) {
      return http.request(
        '/api/v1/oracle/trigger',
        { method: 'POST', body: { event_id: eventId, target, dry_run: dryRun }, idempotencyKey },
        OracleTriggerResponseSchema,
      );
    },

    // A separate method, not a widened `triggerOracleEvent` — deliberately. `triggerOracleEvent`'s
    // `dryRun: true` literal type stays exactly as OC-32/33's final review narrowed it; this is the
    // ONLY place `dry_run: false` appears anywhere in client code, and it's not a parameter — it's
    // hardcoded. Grepping for `fireOracleEvent` finds every real-fire call site in this app.
    fireOracleEvent(eventId: string, target: OracleTarget, idempotencyKey?: string) {
      return http.request(
        '/api/v1/oracle/trigger',
        { method: 'POST', body: { event_id: eventId, target, dry_run: false }, idempotencyKey },
        OracleTriggerResponseSchema,
      );
    },

    setOracleEnabled(enabled: boolean, idempotencyKey?: string) {
      return http.request(
        '/api/v1/oracle/enabled',
        { method: 'POST', body: { enabled }, idempotencyKey },
        OracleEnabledResponseSchema,
      );
    },
  };
}
```

- [ ] **Step 5: Update `StatusScreen.tsx`'s 5 call sites**

In `src/features/status/StatusScreen.tsx`, replace the comment immediately above `startAction` (currently describing `call` as taking `(stepUpCode, idempotencyKey)`) with:

```tsx
  // Safety-review finding 6, 2026-08-14: the idempotency key is generated ONCE per `run()`
  // invocation (inside `useDestructiveAction`) and reused across both the initial attempt and the
  // retry-once-on-403 attempt, so the gateway sees one logical operation, not two, if a step-up
  // window needs to be re-established mid-action. OC-54: `useDestructiveAction` now calls
  // `api.auth.stepUp()` itself before invoking this closure — `call` no longer takes a TOTP code
  // at all.
```

Then replace the 5 `useDestructiveAction` calls (the "Bonus fix" comment between `startAction` and `stopAction` is untouched — it doesn't reference the code parameter):

```tsx
  const startAction = useDestructiveAction((idempotencyKey) =>
    api.write.startServer(idempotencyKey),
  );
  // Bonus fix, safety review 2026-08-14: Detener issued while 'starting' (the escape hatch for a
  // stalled start, finding 3 from the prior round) now sends `mode: 'immediate'` instead of the
  // `graceful`/30s drain used from 'running' — a graceful drain of a server that never finished
  // starting up may itself just hang, which isn't a useful abort for this specific case.
  // `stopMode` is captured at button-press time (see the two Detener `onPress` handlers below),
  // not read live from `state`, so the body sent matches exactly what the sheet described.
  const stopAction = useDestructiveAction((idempotencyKey) =>
    api.write.stopServer(
      stopMode === 'immediate' ? { mode: 'immediate' } : { mode: 'graceful', seconds: 30 },
      idempotencyKey,
    ),
  );
  const restartAction = useDestructiveAction((idempotencyKey) =>
    api.write.restartServer({ seconds: 30 }, idempotencyKey),
  );
  const cancelAction = useDestructiveAction((idempotencyKey) =>
    api.write.cancelShutdown(idempotencyKey),
  );
  const disconnectAllAction = useDestructiveAction((idempotencyKey) =>
    api.write.disconnectAll(idempotencyKey),
  );
```

- [ ] **Step 6: Update `OracleComposerScreen.tsx`'s 1 call site**

In `src/features/oracle/OracleComposerScreen.tsx`, replace the `stageAction` declaration:

```tsx
  const stageAction = useDestructiveAction((idempotencyKey) => {
    const dmEvent = buildDmEvent();
    // Unreachable while the button is disabled — but the invariant lives in the type system here,
    // not only in a prop: an invalid form refuses to produce a write, it does not stage a guess.
    if (dmEvent === null) throw new Error('invalid form state');
    return api.write.stageOracleEvent(stagedId, dmEvent, idempotencyKey);
  });
```

- [ ] **Step 7: Update `OracleDryRunScreen.tsx`'s 2 call sites**

In `src/features/oracle/OracleDryRunScreen.tsx`, replace `triggerAction`:

```tsx
  const triggerAction = useDestructiveAction((idempotencyKey) => {
    const target = buildTarget(playersRef.current);
    if (!target) {
      // Operator-facing Spanish, not an internal debug string: the only way to actually reach
      // this throw is the selected player going offline DURING the step-up wait (the button is
      // disabled otherwise), and this message renders verbatim through `gatewayErrorMessage`/
      // `ActionError`. Same text as the `selectedPlayerOffline` banner below, deliberately.
      throw new Error('Este jugador ya no está conectado.');
    }
    return api.write.triggerOracleEvent(eventId, target, true, idempotencyKey);
  });
```

And replace `fireAction` (every comment inside is preserved verbatim — only the closure's parameter list and the arguments passed to `api.write.fireOracleEvent` change):

```tsx
  const fireAction = useDestructiveAction(
    async (idempotencyKey) => {
      if (!result) {
        throw new Error('No hay una vista previa vigente.');
      }
      if (result.target.type === 'player') {
        const freshPlayers = (await playersQuery.refetch()).data ?? playersRef.current;
        if (!isOnline(freshPlayers, result.target.alias)) {
          throw new Error('Este jugador ya no está conectado.');
        }
      }
      try {
        return await api.write.fireOracleEvent(eventId, result.target, idempotencyKey);
      } catch (err) {
        // Classified here rather than after `run()` resolves, because `run()` collapses every
        // failure mode into a `null` return (a cancelled step-up included) and its `error` state
        // isn't readable from the closure that awaited it. Rethrown untouched so the hook's
        // step-up retry branch and its `error` state behave exactly as before — this catch only
        // records WHICH kind of failure it was. Functional `setResult` so it can't clobber a
        // concurrent update with a stale `result` capture.
        if (isIndeterminateFireFailure(err)) {
          setResult((prev) => (prev ? { ...prev, fireOutcomeUnknown: true } : prev));
        }
        throw err;
      }
    },
    // Fire must never silently ride a step-up obtained for a different, earlier action — a
    // dry-run immediately precedes almost every fire in the intended flow, and that dry-run just
    // populated the 90s step-up cache, so without this Fire would almost always skip a fresh TOTP
    // prompt entirely, collapsing the ticket's intended "step-up AND typing FIRE" double gate on
    // the app's single most consequential action down to just the typing.
    { forceFreshStepUp: true },
  );
```

The comment block above `fireAction` in the current file (explaining why `result.target` is frozen and why the online-check re-`refetch`s) does not reference the `code` parameter — leave it exactly as-is, unmodified, directly above the replaced block.

- [ ] **Step 8: Update `OracleEventsScreen.tsx`'s 2 call sites**

In `src/features/oracle/OracleEventsScreen.tsx`, replace `disableAction`/`enableAction`:

```tsx
  const disableAction = useDestructiveAction((idempotencyKey) =>
    api.write.setOracleEnabled(false, idempotencyKey),
  );
  const enableAction = useDestructiveAction((idempotencyKey) =>
    api.write.setOracleEnabled(true, idempotencyKey),
  );
```

- [ ] **Step 9: Update `PlayerAccountsScreen.tsx`'s 1 call site**

In `src/features/playerAccounts/PlayerAccountsScreen.tsx`, replace the `unlockAction` declaration:

```tsx
  const unlockAction = useDestructiveAction<void>((idempotencyKey) =>
    api.write.unlockPlayer2fa(username.trim(), idempotencyKey),
  );
```

The comment a few lines below (inside `handleConfirm`, explaining why the check is `result !== null` and not `!== undefined`) is about `run()`'s return type, unrelated to this parameter change — leave it untouched.

- [ ] **Step 10: Typecheck, lint, format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

`tsc` must report 0 errors — this is the step that actually proves every call site's signature change lines up with `writeApi.ts`'s new signatures and `useDestructiveAction`'s new `call` type. If `format:check` fails on any file touched in this task, run `npx prettier --write <file>` and re-check; do not hand-fix formatting.

- [ ] **Step 11: Commit**

```bash
git add src/api/httpClient.ts src/api/authApi.ts src/features/status/useDestructiveAction.ts \
  src/api/writeApi.ts src/features/status/StatusScreen.tsx \
  src/features/oracle/OracleComposerScreen.tsx src/features/oracle/OracleDryRunScreen.tsx \
  src/features/oracle/OracleEventsScreen.tsx src/features/playerAccounts/PlayerAccountsScreen.tsx
git commit -m "feat(oc54): session-scoped step-up on the client"
```

---

### Task 2: Mock gateway session-scoped rewrite, docs, live verification

**Files:**
- Modify: `tools/mock-gateway/src/state.js`
- Create: `tools/mock-gateway/src/routes/stepUp.js`
- Modify: `tools/mock-gateway/src/middleware/stepUp.js`
- Modify: `tools/mock-gateway/server.js`
- Modify: `docs/reference/gateway-api-contract.md`
- Modify: `.claude/skills/ops-gateway-api/SKILL.md`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: Task 1's `api.auth.stepUp()` and the rewritten `useDestructiveAction` — the live-verification pass in this task's final step exercises the full client-to-mock round trip, so Task 1 must already be committed on this branch.
- Produces: nothing further consumed by another task — this is the last task in the plan.

- [ ] **Step 1: Update `state.js`'s session comment**

In `tools/mock-gateway/src/state.js`, change the `sessions` line's comment to name the new field:

```js
  sessions: new Map(), // token -> { operator, expiresAt, createdAt, csrfToken, steppedUpUntil }
```

No other change to this file — `steppedUpUntil` is set dynamically by the new step-up route (Step 3 below), not present at session creation (`auth.js`'s `issueSession` is untouched).

- [ ] **Step 2: Rewrite `middleware/stepUp.js` to check session state, not a header**

Replace the full contents of `tools/mock-gateway/src/middleware/stepUp.js` with:

```js
const { sendError } = require('../errors');
const { state } = require('../state');

// Rewritten for OC-54 to check session state instead of trusting a client-supplied header — the
// exact same shape of change OC-53 made to requireCsrf. A request whose session never stepped up,
// or whose 5-minute window has lapsed, is treated identically: fail closed, matching the real
// gateway (xindeler-zuul's require_step_up reads session.step_up_until the same way).
function requireStepUp(req, res, next) {
  const session = state.sessions.get(req.token);
  if (!session || !session.steppedUpUntil || session.steppedUpUntil < Date.now()) {
    return sendError(res, 403, 'step_up_required', 'Esta acción requiere un step-up TOTP vigente');
  }
  next();
}

module.exports = { requireStepUp };
```

`requireStepUp` still mounts after `requireAuth` (which sets `req.token`) on every route that uses it, exactly as before — `server.js`'s mount order is unchanged by this step.

- [ ] **Step 3: Create the new `POST /api/v1/step-up` route**

Create `tools/mock-gateway/src/routes/stepUp.js`:

```js
const express = require('express');
const { sendError } = require('../errors');
const { state } = require('../state');

const router = express.Router();
const STEP_UP_TTL_MS = 5 * 60 * 1000;

// Mirrors xindeler-zuul's real POST /step-up (login.rs): verifies a TOTP code against the
// CURRENT session (requireAuth/requireCsrf already ran by the time this handler runs, so
// req.token is set and CSRF is already validated) and, on success, opens a 5-minute step-up
// window on that session — matching the real gateway's STEP_UP_TTL_SECS. Wrong code → 401 (not
// 403 — this route itself isn't gated BY step-up, it's what GRANTS step-up), the same status the
// real gateway's `rejected()` helper returns for a bad TOTP code here.
router.post('/', (req, res) => {
  const { totp_code: totpCode } = req.body || {};
  if (totpCode !== '000000') {
    return sendError(res, 401, 'invalid_totp', 'Código TOTP inválido');
  }
  const session = state.sessions.get(req.token);
  session.steppedUpUntil = Date.now() + STEP_UP_TTL_MS;
  res.status(204).end();
});

module.exports = router;
```

(`req.token` is guaranteed set and to resolve to a live session by the time this handler runs — `requireAuth` mounts before this route in `server.js` and already validated it.)

- [ ] **Step 4: Mount the new route in `server.js`**

In `tools/mock-gateway/server.js`, add the import near the other route requires (right after the `oracleBudgetRoutes` require, before the `requireStepUp`/`requireCsrf` middleware requires):

```js
const oracleBudgetRoutes = require('./src/routes/oracleBudget');
const stepUpRoutes = require('./src/routes/stepUp');
const { requireStepUp } = require('./src/middleware/stepUp');
const { requireCsrf } = require('./src/middleware/csrf');
```

And add the mount right after the auth mount (bare path, matching the real gateway's own unnested `/step-up` route — placed near the other auth-adjacent mount, ahead of the read-surface routes):

```js
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/step-up', requireAuth, requireCsrf, stepUpRoutes);

app.use('/api/v1/status', requireAuth, statusRoutes);
```

Every other line in `server.js` is unchanged.

- [ ] **Step 5: Update `gateway-api-contract.md`**

In `docs/reference/gateway-api-contract.md`, replace the §1 Conventions bullet about the step-up header:

Old:
```
- Destructive endpoints (§4, §5) require a step-up header `X-Ops-Totp: <6 digits>` in addition
  to the session token.
```

New:
```
- Destructive endpoints (§4, §5) require an active step-up window on the session, not a
  per-request header. Call `POST /api/v1/step-up` (§2.1) with a fresh TOTP code first; on success
  the gateway opens a 5-minute window during which destructive writes need no extra header at
  all. Confirmed 2026-08-15 against the real `xindeler-zuul` source (`login.rs`/`session.rs`/
  `lifecycle.rs`) — it never reads a per-request TOTP header on any route.
```

Then add a new `### 2.1` subsection immediately after the existing ⚠️ note that closes §2 (the one about the gateway authenticating against `xindeler-auth`'s short-TTL tokens) and before the `---` that starts §3:

```
### 2.1 Step-up (destructive-action re-verification)

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/v1/step-up` | `{ totp_code }` → `204` on success |

Bare path, **not** nested under `/api/v1/auth/`, unlike every other endpoint in this section —
matches the real `xindeler-zuul` router (`web.rs`) exactly. Requires an already-valid session
(bearer or cookie) plus the `x-csrf-token` header like any other mutating request (§1); a
successful call opens a 5-minute step-up window on that session (`STEP_UP_TTL_SECS` in the real
gateway's `session.rs`), during which every destructive endpoint in §4/§5 accepts writes with no
further step-up signal at all. Wrong or missing code → `401 invalid_credentials` (`rejected()` on
the real gateway). A destructive write outside a step-up window → `403 "step-up required"`.

**Client rule:** `useDestructiveAction` calls this endpoint itself, transparently, immediately
before every destructive write — the operator only ever sees the existing TOTP prompt, never a
second, separate step-up screen.

⚠️ Confirmed 2026-08-15 (OC-54) that the real gateway's error bodies for both this endpoint and
every destructive route are **plain text**, not this doc's own §1 JSON envelope convention. The
client already degrades safely (`httpClient.ts`'s envelope parse falls back to a generic message
on a non-JSON body) but not legibly. Separate, pre-existing, cross-cutting mismatch — not fixed by
OC-54, not yet ticketed.
```

- [ ] **Step 6: Update `.claude/skills/ops-gateway-api/SKILL.md`'s step-up rule**

In `.claude/skills/ops-gateway-api/SKILL.md`, replace rule 4 under "Rules for every call":

Old:
```
4. **Step-up (`X-Ops-Totp`) on every destructive call.** Lifecycle writes and all ORACLE writes.
   Reads are session-only.
```

New:
```
4. **Step-up (`POST /api/v1/step-up`, session-scoped) before every destructive call.** Lifecycle
   writes and all ORACLE writes. Call `/api/v1/step-up` with a fresh TOTP code to open a 5-minute
   window on the session, then send the write itself with no extra header — the real gateway does
   not read a per-request step-up header on any route (confirmed 2026-08-15, OC-54). Reads are
   session-only.
```

- [ ] **Step 7: Typecheck, lint, format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

The mock gateway is plain JS and not covered by `tsc`/ESLint's TypeScript rules, but this confirms Task 1's client changes still typecheck/lint clean with this task's files present, and that the two Markdown edits didn't introduce anything Prettier objects to (note: `.prettierignore` excludes `*.md`, so `format:check` will not actually touch the two doc files — this is expected, not a gap).

- [ ] **Step 8: Live verification**

Start both processes in the background and confirm they're up:

```bash
npm run mock-gateway
npx expo start --web
```

Using the `claude-in-chrome` browser tools, log in as `matias`/`mock`, TOTP `000000`. Then, with a `window.fetch` monkeypatch (or `read_network_requests`) to observe actual outgoing requests and responses:

1. Trigger one destructive action end-to-end — the ORACLE kill switch (`/oracle-events`, "Desactivar"/"Activar") is a good choice: single confirm, no extra form state. Confirm the TOTP prompt appears exactly once (not twice), and confirm the operator-visible flow feels unchanged from before this ticket.
2. Confirm the actual network sequence for that one tap is now **two** requests, in order: `POST /api/v1/step-up` (`{ totp_code: "000000" }` → `204`, no body) followed by the real action's own request (`POST /api/v1/oracle/enabled` in this example) — and confirm **neither** request carries an `X-Ops-Totp` header.
3. Confirm the second request succeeds (`200`/`204` as appropriate) and the screen reflects the new state.
4. Repeat steps 1-3 for a second, distinct destructive action from a different screen (e.g. the player-unlock screen's "Desbloquear 2FA", or `StatusScreen.tsx`'s "Cancelar" if the server is in a cancellable state) to confirm the mechanism isn't special-cased to one screen.
5. Confirm a wrong TOTP code is still rejected: this is harder to trigger through the UI directly (the operator's own `useStepUpAuth` TOTP input likely validates format but not correctness client-side) — if the UI allows submitting an incorrect 6-digit code, do so and confirm the mock's `/api/v1/step-up` returns `401 invalid_totp` and the operator sees an inline error, not a silent failure or a false success.
6. **Do not attempt to force the 5-minute step-up window to expire mid-test.** This implementation's design calls `api.auth.stepUp()` fresh on every single `run()` — including when `requestStepUp()` returns a cached client-side TOTP code — so the server-side window is always re-established immediately before the write that uses it. The retry-on-403 branch in `useDestructiveAction.ts` is defense-in-depth (it also catches an unrelated CSRF 403) rather than a path this design exercises in normal operation; record this explicitly in the backlog row (Step 9) as "not live-verified, and not practically reachable under this design without artificially shortening the mock's `STEP_UP_TTL_MS`" rather than skipping the note or claiming a verification that didn't happen.

Record exact observed request/response pairs (paths, headers present/absent, status codes, bodies) — the backlog row in Step 9 must cite them concretely, matching the level of detail OC-52's and OC-53's own backlog rows already set as this repo's convention.

- [ ] **Step 9: Write the `docs/backlog.md` row**

Run `git log --oneline` to get this task's actual commit hashes, and `.superpowers/sdd/2026-08-15-step-up-session-mechanism-implementation/` (this plan's SDD workspace, if using subagent-driven-development) for the exact task-completion record.

Add a new row to the `Phase 6 — Later / opportunistic` table in `docs/backlog.md`, immediately after the existing `OC-53` row (before the table's closing `---`). Follow the exact prose density and structure of the `OC-52`/`OC-53` rows immediately above it — a single dense paragraph covering: what was broken and how it was found (the session-scoped-vs-header discovery from OC-52's own final review, already written up in `docs/specs/2026-08-15-step-up-session-mechanism-design.md`); the fix (session-scoped `api.auth.stepUp()` call before every destructive write, `useDestructiveAction` rewrite, `writeApi.ts`'s 10 methods losing `stepUpCode`, the mock's mirrored `steppedUpUntil` session model); the actual commit hashes for Task 1 and Task 2; the concrete, actually-observed live-verification results from Step 8 (including the explicit note about the retry-on-403 path not being practically live-testable under this design, per Step 8 point 6 — do not omit this, and do not claim it was tested if it wasn't); the `npx tsc --noEmit`/`npm run lint`/`npm run format:check` results; and a closing note on what remains explicitly out of scope (which endpoints require step-up, the plain-text error body shape, the audit-row shape mismatch — all three already named in the design spec's "Out of scope" section and in this plan's Global Constraints).

Use status `✅` (this ticket ships complete in this plan, not partially).

- [ ] **Step 10: Commit**

```bash
git add tools/mock-gateway/src/state.js tools/mock-gateway/src/routes/stepUp.js \
  tools/mock-gateway/src/middleware/stepUp.js tools/mock-gateway/server.js \
  docs/reference/gateway-api-contract.md .claude/skills/ops-gateway-api/SKILL.md docs/backlog.md
git commit -m "feat(oc54): session-scoped step-up on the mock gateway, docs"
```

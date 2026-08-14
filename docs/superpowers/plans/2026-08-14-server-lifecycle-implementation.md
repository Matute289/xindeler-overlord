# Server Lifecycle (OC-25 + OC-26) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the write API for server lifecycle control, the client-side lifecycle state machine
(bootstrapped from `status`, driven live by the `lifecycle` SSE event), the reusable
confirm→step-up→call→retry orchestration, and wire all of it into `StatusScreen` with real
Start/Stop/Restart/Cancel/Disconnect-all controls — the first real consumers of OC-23's step-up
mechanism and OC-24's confirm-by-typing sheet.

**Architecture:** `src/api/writeApi.ts` mirrors `readApi.ts`'s shape for the five `/api/v1/server/*`
mutations. `src/features/status/useLifecycleState.ts` derives an initial state from `status`, then
lets a real `lifecycle` SSE event permanently override it. `src/features/status/
useDestructiveAction.ts` is a small reusable hook wrapping any one destructive call in step-up
request/retry logic. `StatusScreen.tsx` composes all three into the actual controls.

**Tech Stack:** Existing `httpClient`/`StepUpContext`/`ConfirmByTypingSheet`/`gatewayErrorMessage`
infrastructure — no new dependencies.

## Global Constraints

- `src/api/writeApi.ts` mirrors `readApi.ts` exactly: same `HttpClient` type alias, same factory-
  function shape (`createWriteApi(http)` returning an object of methods), each method a thin call to
  `http.request(path, options, schema)`. Response validated with `OkResponseSchema = z.object({ ok:
  z.boolean() })`.
- `LifecycleState = 'running' | 'draining' | 'stopped' | 'starting'` — exact union, matching
  `LifecycleEventSchema`'s `state` enum (`src/api/schemas.ts`, already exists, do not modify).
- Once a real `lifecycle` SSE event has been received by a given `useLifecycleState` instance, it
  permanently wins over further derivation from `status` for that instance's lifetime — never revert
  to a derived guess once live data exists.
- `useDestructiveAction`'s retry is exactly one attempt: on a `403` with code `invalid_totp` or
  `step_up_required`, call `requestStepUp({ forceFresh: true })` once and retry the call once. A
  second failure surfaces as a real error, not retried again.
- A cancelled step-up prompt (`isStepUpCancelled(err)` true) produces NO error state — the action
  just returns to idle. Only `isStepUpCancelled(err) === false` errors populate `useDestructiveAction`'s
  `error`.
- Confirm-by-typing (`ConfirmByTypingSheet`, `word="RESTART"`/`word="STOP"`) gates ONLY Restart and
  Stop. Start, Cancel, and Disconnect-all go straight to step-up with no typed confirmation first.
- Stop is always `{ mode: 'graceful', seconds: 30 }`; Restart is always `{ seconds: 30 }` — no
  immediate-mode toggle, no seconds picker, no reason field in this ticket.
- Action buttons visible per lifecycle state: `'running'` → Reiniciar + Detener + Desconectar a
  todos. `'draining'` → Cancelar + Desconectar a todos ONLY (Cancel must never be hidden or disabled
  during a drain, per backlog). `'stopped'` → Iniciar only. `'starting'` → no buttons.
- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check`, plus a live pass per task (Task 4's is the comprehensive one — this ticket's
  consumers are real and permanent, not a temporary throwaway harness like OC-23/24 used).

---

### Task 1: `writeApi.ts` + `apiClient.ts` wiring

**Files:**
- Create: `src/api/writeApi.ts`
- Modify: `src/api/apiClient.ts`

**Interfaces:**
- Consumes: `createHttpClient`'s return type (`src/api/httpClient.ts`, already exists, has
  `request<T>(path, options, schema?)` including the `stepUpCode` option from OC-23).
- Produces: `createWriteApi(http): { startServer, stopServer, restartServer, cancelShutdown,
  disconnectAll }` — consumed by Task 4's `StatusScreen.tsx` via `api.write.*`.

- [ ] **Step 1: Write `src/api/writeApi.ts`**

```ts
import { z } from 'zod';

import type { createHttpClient } from './httpClient';

type HttpClient = ReturnType<typeof createHttpClient>;

const OkResponseSchema = z.object({ ok: z.boolean() });

export function createWriteApi(http: HttpClient) {
  return {
    startServer(stepUpCode: string) {
      return http.request(
        '/api/v1/server/start',
        { method: 'POST', body: {}, stepUpCode },
        OkResponseSchema,
      );
    },

    stopServer(
      stepUpCode: string,
      body: { mode: 'graceful' | 'immediate'; seconds?: number; reason?: string },
    ) {
      return http.request(
        '/api/v1/server/stop',
        { method: 'POST', body, stepUpCode },
        OkResponseSchema,
      );
    },

    restartServer(stepUpCode: string, body: { seconds: number; reason?: string }) {
      return http.request(
        '/api/v1/server/restart',
        { method: 'POST', body, stepUpCode },
        OkResponseSchema,
      );
    },

    cancelShutdown(stepUpCode: string) {
      return http.request(
        '/api/v1/server/cancel_shutdown',
        { method: 'POST', body: {}, stepUpCode },
        OkResponseSchema,
      );
    },

    disconnectAll(stepUpCode: string) {
      return http.request(
        '/api/v1/server/disconnect_all',
        { method: 'POST', body: {}, stepUpCode },
        OkResponseSchema,
      );
    },
  };
}
```

- [ ] **Step 2: Wire it into `src/api/apiClient.ts`**

Read the current file first — confirm it still matches:
```ts
import * as Crypto from 'expo-crypto';

import { sessionStorage } from '../auth/sessionStorage';
import { createAuthApi } from './authApi';
import { createHttpClient } from './httpClient';
import { createReadApi } from './readApi';

export function createApiClient(baseUrl: string) {
  const http = createHttpClient(baseUrl, {
    getAuthHeader: () => sessionStorage.getAuthHeader(),
    generateIdempotencyKey: () => Crypto.randomUUID(),
  });

  return {
    auth: createAuthApi(http),
    read: createReadApi(http),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
```

Change to:
```ts
import * as Crypto from 'expo-crypto';

import { sessionStorage } from '../auth/sessionStorage';
import { createAuthApi } from './authApi';
import { createHttpClient } from './httpClient';
import { createReadApi } from './readApi';
import { createWriteApi } from './writeApi';

export function createApiClient(baseUrl: string) {
  const http = createHttpClient(baseUrl, {
    getAuthHeader: () => sessionStorage.getAuthHeader(),
    generateIdempotencyKey: () => Crypto.randomUUID(),
  });

  return {
    auth: createAuthApi(http),
    read: createReadApi(http),
    write: createWriteApi(http),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
```

- [ ] **Step 3: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 4: Commit**

```bash
git add src/api/writeApi.ts src/api/apiClient.ts
git commit -m "feat(oc25-26): write API for server lifecycle endpoints"
```

---

### Task 2: `useLifecycleState.ts`

**Files:**
- Create: `src/features/status/useLifecycleState.ts`

**Interfaces:**
- Consumes: `Status` type (`@/api/schemas`, already exists), `useStreamEvent` (`@/stream/StreamContext`,
  already exists, `useStreamEvent('lifecycle', handler)` where `handler: (event: LifecycleEvent) =>
  void` and `LifecycleEvent = { state: 'running'|'draining'|'stopped'|'starting', seconds_left?:
  number }`).
- Produces: `type LifecycleState = 'running' | 'draining' | 'stopped' | 'starting'`,
  `useLifecycleState(status: Status | undefined): { state: LifecycleState; secondsLeft?: number } |
  undefined` — consumed by Task 4's `StatusScreen.tsx`.

- [ ] **Step 1: Write `src/features/status/useLifecycleState.ts`**

```ts
import { useState } from 'react';

import type { Status } from '@/api/schemas';
import { useStreamEvent } from '@/stream/StreamContext';

export type LifecycleState = 'running' | 'draining' | 'stopped' | 'starting';

// There's no GET /lifecycle bootstrap endpoint (only the SSE event) — before any real event
// has arrived, derive a best-effort initial state from the status snapshot this screen already
// fetches. Two known simplifications: `service: 'failed'` folds into 'stopped' (there's no
// separate lifecycle state for it), and a derived guess can never distinguish 'stopped' from
// 'starting' (status reads 'inactive' for both) — self-corrects the moment a real event arrives.
function deriveFromStatus(status: Status): { state: LifecycleState; secondsLeft?: number } {
  if (status.pending_shutdown) {
    return { state: 'draining', secondsLeft: status.pending_shutdown.seconds_left };
  }
  if (status.service === 'active') {
    return { state: 'running' };
  }
  return { state: 'stopped' };
}

export function useLifecycleState(
  status: Status | undefined,
): { state: LifecycleState; secondsLeft?: number } | undefined {
  const [live, setLive] = useState<{ state: LifecycleState; secondsLeft?: number } | null>(null);

  useStreamEvent('lifecycle', (event) => {
    setLive({ state: event.state, secondsLeft: event.seconds_left });
  });

  if (live) return live;
  if (status) return deriveFromStatus(status);
  return undefined;
}
```

- [ ] **Step 2: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 3: Commit**

```bash
git add src/features/status/useLifecycleState.ts
git commit -m "feat(oc25-26): useLifecycleState — status-derived + SSE-driven lifecycle state"
```

---

### Task 3: `useDestructiveAction.ts`

**Files:**
- Create: `src/features/status/useDestructiveAction.ts`

**Interfaces:**
- Consumes: `isApiError` (`@/api`, already exists), `isStepUpCancelled`, `useStepUpAuth` (`@/auth/
  StepUpContext`, both already exist from OC-23).
- Produces: `useDestructiveAction<T>(call: (stepUpCode: string) => Promise<T>): { run: () =>
  Promise<void>; pending: boolean; error: Error | null }` — consumed by Task 4's `StatusScreen.tsx`,
  once per action (5 instances: start/stop/restart/cancel/disconnectAll).

- [ ] **Step 1: Write `src/features/status/useDestructiveAction.ts`**

```ts
import { useState } from 'react';

import { isApiError } from '@/api';
import { isStepUpCancelled, useStepUpAuth } from '@/auth/StepUpContext';

const STEP_UP_ERROR_CODES = new Set(['invalid_totp', 'step_up_required']);

export function useDestructiveAction<T>(call: (stepUpCode: string) => Promise<T>) {
  const { requestStepUp } = useStepUpAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const code = await requestStepUp();
      try {
        await call(code);
      } catch (err) {
        if (isApiError(err) && STEP_UP_ERROR_CODES.has(err.code)) {
          const freshCode = await requestStepUp({ forceFresh: true });
          await call(freshCode);
        } else {
          throw err;
        }
      }
    } catch (err) {
      if (err instanceof Error && !isStepUpCancelled(err)) {
        setError(err);
      }
      // A cancelled step-up prompt is a deliberate operator choice, not a failure — no error
      // state, the action button just goes back to idle.
    } finally {
      setPending(false);
    }
  }

  return { run, pending, error };
}
```

- [ ] **Step 2: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 3: Commit**

```bash
git add src/features/status/useDestructiveAction.ts
git commit -m "feat(oc25-26): useDestructiveAction — confirm/step-up/call/retry orchestration"
```

---

### Task 4: `StatusScreen.tsx` wiring + live verification + backlog

**Files:**
- Modify: `src/features/status/StatusScreen.tsx`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `createWriteApi`'s methods via `useApi().write.*` (Task 1); `useLifecycleState`,
  `LifecycleState` (Task 2); `useDestructiveAction` (Task 3); `ConfirmByTypingSheet` (`@/ui/
  ConfirmByTypingSheet`, OC-24, already exists); `gatewayErrorMessage`, `isLikelyVpnDown`,
  `VpnSettingsButton` (OC-22, already exist); `useEnvironment` (already exists); `Button` (already
  exists).
- Produces: nothing — end of this plan's chain.

- [ ] **Step 1: Replace `src/features/status/StatusScreen.tsx` in full**

Read the current file first — confirm it still matches (it was last touched by OC-22, which added
`GatewayErrorEmpty`). Current file (97 lines) — full current content:
```tsx
import { Text, View } from 'react-native';

import type { Status } from '@/api/schemas';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { Empty } from '@/ui/Empty';
import { fonts } from '@/ui/theme';

import { StatRow } from './StatRow';
import { useStatusQuery } from './useStatusQuery';

const dateTimeFormat = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function formatStartedAt(startedAt: string | null): string {
  if (!startedAt) return '—';
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormat.format(date);
}

function serviceLabel(status: Status): string {
  if (status.service === 'active' && status.health) return 'En línea';
  if (status.service === 'active' && !status.health) return 'En línea (unhealthy)';
  if (status.service === 'failed') return 'Falló';
  return 'Inactiva';
}

export function StatusScreen() {
  const query = useStatusQuery();

  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Status" error={query.error} />;
    }
    return <Empty title="Status" message="Cargando…" />;
  }

  const status = query.data;
  const isUp = status.service === 'active' && status.health;

  return (
    <View className="flex-1 px-6 pt-8">
      <View className="flex-row items-center gap-2">
        <View
          className={`h-3 w-3 rounded-full ${isUp ? 'bg-accent-cyan dark:bg-night-accent-cyan' : 'bg-danger dark:bg-night-danger'}`}
        />
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          {serviceLabel(status)}
        </Text>
      </View>

      {status.pending_shutdown && (
        <View className="mt-4 items-center rounded-lg bg-danger px-4 py-3 dark:bg-night-danger">
          <Text className="text-white" style={{ fontFamily: fonts.semibold }}>
            {`Apagando en ${status.pending_shutdown.seconds_left}s — ${status.pending_shutdown.reason}`}
          </Text>
        </View>
      )}

      <View className="mt-6">
        <StatRow label="Versión" value={status.version} />
        <StatRow label="Uptime" value={formatUptime(status.uptime_secs)} />
        <StatRow label="Jugadores" value={String(status.players_online)} />
        <StatRow
          label="Tick time"
          value={status.tick_time_ms !== null ? `${status.tick_time_ms} ms` : '—'}
        />
        <StatRow label="Entidades" value={String(status.entity_count)} />
        <StatRow label="Chunks" value={String(status.chunk_count)} />
        <StatRow label="Iniciado" value={formatStartedAt(status.started_at)} />
      </View>
    </View>
  );
}
```

Replace the ENTIRE file with:
```tsx
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import type { Status } from '@/api/schemas';
import { useEnvironment } from '@/config/EnvironmentContext';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { gatewayErrorMessage, isLikelyVpnDown } from '@/features/connectivity/gatewayErrorMessage';
import { VpnSettingsButton } from '@/features/connectivity/VpnSettingsButton';
import { Button } from '@/ui/Button';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { Empty } from '@/ui/Empty';
import { fonts } from '@/ui/theme';

import { StatRow } from './StatRow';
import { useDestructiveAction } from './useDestructiveAction';
import type { LifecycleState } from './useLifecycleState';
import { useLifecycleState } from './useLifecycleState';
import { useStatusQuery } from './useStatusQuery';

const dateTimeFormat = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function formatStartedAt(startedAt: string | null): string {
  if (!startedAt) return '—';
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormat.format(date);
}

function serviceLabel(status: Status): string {
  if (status.service === 'active' && status.health) return 'En línea';
  if (status.service === 'active' && !status.health) return 'En línea (unhealthy)';
  if (status.service === 'failed') return 'Falló';
  return 'Inactiva';
}

function ActionError({ error }: { error: Error }) {
  const { environment } = useEnvironment();
  return (
    <View className="mt-2 items-center">
      <Text className="text-center text-xs text-danger dark:text-night-danger">
        {gatewayErrorMessage(environment.id, error)}
      </Text>
      {isLikelyVpnDown(environment.id, error) && <VpnSettingsButton />}
    </View>
  );
}

export function StatusScreen() {
  const query = useStatusQuery();
  const api = useApi();
  const lifecycle = useLifecycleState(query.data);
  const [confirmAction, setConfirmAction] = useState<'restart' | 'stop' | null>(null);

  const startAction = useDestructiveAction((code) => api.write.startServer(code));
  const stopAction = useDestructiveAction((code) =>
    api.write.stopServer(code, { mode: 'graceful', seconds: 30 }),
  );
  const restartAction = useDestructiveAction((code) =>
    api.write.restartServer(code, { seconds: 30 }),
  );
  const cancelAction = useDestructiveAction((code) => api.write.cancelShutdown(code));
  const disconnectAllAction = useDestructiveAction((code) => api.write.disconnectAll(code));

  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Status" error={query.error} />;
    }
    return <Empty title="Status" message="Cargando…" />;
  }

  const status = query.data;
  const isUp = status.service === 'active' && status.health;
  const state: LifecycleState | undefined = lifecycle?.state;

  function handleSheetConfirm() {
    if (confirmAction === 'restart') restartAction.run();
    if (confirmAction === 'stop') stopAction.run();
    setConfirmAction(null);
  }

  return (
    <View className="flex-1 px-6 pt-8">
      <View className="flex-row items-center gap-2">
        <View
          className={`h-3 w-3 rounded-full ${isUp ? 'bg-accent-cyan dark:bg-night-accent-cyan' : 'bg-danger dark:bg-night-danger'}`}
        />
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          {serviceLabel(status)}
        </Text>
      </View>

      {state === 'draining' && (
        <View className="mt-4 items-center rounded-lg bg-danger px-4 py-3 dark:bg-night-danger">
          <Text className="text-white" style={{ fontFamily: fonts.semibold }}>
            {`Deteniéndose en ${lifecycle?.secondsLeft ?? status.pending_shutdown?.seconds_left ?? '—'}s${
              status.pending_shutdown?.reason ? ` — ${status.pending_shutdown.reason}` : ''
            }`}
          </Text>
        </View>
      )}

      {state === 'starting' && (
        <View className="mt-4 items-center rounded-lg bg-steel-dark px-4 py-3 dark:bg-night-steel-dark">
          <Text
            className="text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.semibold }}
          >
            Iniciando…
          </Text>
        </View>
      )}

      <View className="mt-6">
        <StatRow label="Versión" value={status.version} />
        <StatRow label="Uptime" value={formatUptime(status.uptime_secs)} />
        <StatRow label="Jugadores" value={String(status.players_online)} />
        <StatRow
          label="Tick time"
          value={status.tick_time_ms !== null ? `${status.tick_time_ms} ms` : '—'}
        />
        <StatRow label="Entidades" value={String(status.entity_count)} />
        <StatRow label="Chunks" value={String(status.chunk_count)} />
        <StatRow label="Iniciado" value={formatStartedAt(status.started_at)} />
      </View>

      <View className="mt-6 gap-3">
        <Text
          className="text-sm text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.semibold }}
        >
          Controles
        </Text>

        {state === 'running' && (
          <>
            <Button
              label="Reiniciar"
              onPress={() => setConfirmAction('restart')}
              loading={restartAction.pending}
            />
            {restartAction.error && <ActionError error={restartAction.error} />}
            <Button
              label="Detener"
              onPress={() => setConfirmAction('stop')}
              loading={stopAction.pending}
            />
            {stopAction.error && <ActionError error={stopAction.error} />}
          </>
        )}

        {state === 'draining' && (
          <>
            <Button label="Cancelar" onPress={cancelAction.run} loading={cancelAction.pending} />
            {cancelAction.error && <ActionError error={cancelAction.error} />}
          </>
        )}

        {state === 'stopped' && (
          <>
            <Button label="Iniciar" onPress={startAction.run} loading={startAction.pending} />
            {startAction.error && <ActionError error={startAction.error} />}
          </>
        )}

        {(state === 'running' || state === 'draining') && (
          <>
            <Button
              label="Desconectar a todos"
              onPress={disconnectAllAction.run}
              loading={disconnectAllAction.pending}
            />
            {disconnectAllAction.error && <ActionError error={disconnectAllAction.error} />}
          </>
        )}
      </View>

      <ConfirmByTypingSheet
        visible={confirmAction !== null}
        word={confirmAction === 'restart' ? 'RESTART' : 'STOP'}
        description={
          confirmAction === 'restart'
            ? 'El servidor se reiniciará: detención con drenado, luego arranque automático.'
            : 'El servidor se detendrá con un drenado de 30 segundos.'
        }
        onConfirm={handleSheetConfirm}
        onCancel={() => setConfirmAction(null)}
      />
    </View>
  );
}
```

- [ ] **Step 2: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 3: Live verification — the real thing, not a temporary harness**

Prerequisite: `npm run mock-gateway` running, `npx expo start --web` running, logged in, on the
Status tab.

Drive this sequence, confirming each result before moving to the next (the mock's own timings:
draining countdown ticks once per second; `starting`/`running` transitions after restart/start both
take ~1.5s):

1. **Stop.** Tap "Detener". Confirm the `ConfirmByTypingSheet` appears with `word="STOP"`. Type
   `STOP`, tap Confirmar. Confirm the `StepUpPrompt` appears next. Type `000000`, tap Confirmar.
   Confirm the danger box now shows "Deteniéndose en Ns" counting down, and that ONLY "Cancelar" (plus
   "Desconectar a todos") is visible — not "Reiniciar"/"Detener"/"Iniciar".
2. **Cancel mid-drain.** While the countdown from step 1 is still running, tap "Cancelar". Confirm the
   step-up prompt appears again (Cancel is step-up-gated too, no confirm-by-typing). Enter `000000`.
   Confirm the state reverts to `'running'` immediately (danger box disappears, Reiniciar/Detener
   reappear) — proving Cancel genuinely stayed reachable and functional throughout the drain, per the
   backlog's explicit requirement.
3. **Stop to completion.** Repeat Stop (type `STOP`, step up), this time let the countdown run out.
   Confirm the state reaches `'stopped'` (only "Iniciar" visible, no danger box).
4. **Start.** Tap "Iniciar". Confirm NO confirm-by-typing sheet appears (goes straight to step-up). Step
   up with `000000`. Confirm the state passes through `'starting'` (the steel-colored "Iniciando…" box,
   if the ~1.5s window is observable) and lands on `'running'`.
5. **Restart.** Tap "Reiniciar". Type `RESTART`, confirm, step up. Confirm the state machine runs
   through `draining` → `stopped` → `starting` → `running` AUTOMATICALLY, with no further button taps
   at the `stopped`/`starting` midpoints — the gateway orchestrates the whole sequence once triggered,
   matching the contract's "the gateway owns the orchestration" framing.
6. **Disconnect all.** While `'running'`, tap "Desconectar a todos". Confirm no typed-confirmation
   sheet, just step-up. Step up with `000000`. Navigate to the Logs tab, confirm a new `warn` line
   "Todos los jugadores fueron desconectados" appears.
7. **Wrong step-up code + retry.** Tap any action (e.g. "Iniciar" if currently stopped, or trigger
   another Stop/Restart cycle), and when the step-up prompt appears, type a WRONG code (e.g. `111111`)
   and confirm. Confirm the prompt reappears automatically (the `forceFresh` retry) rather than the
   action silently failing. Enter the correct `000000` this time. Confirm the action succeeds.
8. **Cancelled step-up.** Trigger any action, and at the step-up prompt tap "Cancelar" instead of
   entering a code. Confirm the button returns to its idle (non-loading) state with NO error message
   shown anywhere on screen — a cancelled step-up must be silent, per this plan's Global Constraints.

- [ ] **Step 4: Update `docs/backlog.md`'s OC-25 and OC-26 rows**

Change BOTH rows' status cells from `⬜` to `✅`, each describing its half of what shipped together:
OC-25's row should describe the `useLifecycleState` derive-then-live-override model and why (no
bootstrap endpoint, the `'stopped'`/`'starting'` ambiguity and its self-correcting resolution), and
that it extends `StatusScreen` rather than a new tab. OC-26's row should describe the five actions,
the write API, `useDestructiveAction`'s confirm/step-up/retry orchestration, which actions get
confirm-by-typing and why (a literal reading of OC-24's backlog text), and the live verification
performed (all 8 checks from Step 3). Match the terse, factual style of the existing OC-13 through
OC-24 rows in that file — read a couple of them (especially OC-22's and OC-23's, the two most recent)
for the exact tone/format before writing these.

- [ ] **Step 5: Commit**

```bash
git add src/features/status/StatusScreen.tsx docs/backlog.md
git commit -m "feat(oc25-26): server lifecycle controls on Status screen"
```

---

## Self-Review

**Spec coverage:**
- "The state model" (`useLifecycleState`) → Task 2. ✅
- "The write API" → Task 1. ✅
- "The confirm → step-up → call → retry orchestration" (`useDestructiveAction`) → Task 3. ✅
- "The UI" (lifecycle indicator, gated action buttons, confirm-by-typing scope, error display) →
  Task 4. ✅
- "Testing" (the 8-point live pass) → Task 4 Step 3. ✅
- "Out of scope" (immediate-mode stop, seconds picker, reason field, confirm-by-typing on
  start/cancel/disconnect-all, a dedicated tab) — no task builds any of these. ✅

**Placeholder scan:** No TBD/TODO. Every code step has complete, literal code, including the full
replacement `StatusScreen.tsx` (not a diff-only sketch, to avoid ambiguity about exact final file
shape given how much of the file changes).

**Type consistency:** `createWriteApi`'s five methods (Task 1) are called with matching signatures in
Task 4's `StatusScreen.tsx` (`api.write.startServer(code)`, `api.write.stopServer(code, {mode,
seconds})`, etc. — argument shapes match Task 1's declared parameter types exactly).
`useLifecycleState(status: Status | undefined)`'s return type (Task 2) — `{state, secondsLeft?} |
undefined` — is consumed correctly in Task 4 via `lifecycle?.state`/`lifecycle?.secondsLeft` optional
chaining, matching the `| undefined` possibility. `useDestructiveAction<T>(call)`'s return shape
(`{run, pending, error}`, Task 3) is destructured identically for all 5 instances in Task 4
(`xAction.run`/`xAction.pending`/`xAction.error`). `isStepUpCancelled`/`useStepUpAuth` (both from
OC-23, already shipped) are referenced with the exact export names OC-23's final code uses.

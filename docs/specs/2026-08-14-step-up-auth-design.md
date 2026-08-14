# Step-up auth (OC-23) design

## Problem

`docs/reference/gateway-api-contract.md` §1: *"Destructive endpoints (§4, §5) require a step-up
header `X-Ops-Totp: <6 digits>` in addition to the session token."* Backlog OC-23: *"TOTP re-prompt
for destructive actions, cached for a short window, per contract §1."*

No destructive-action screen exists yet in this app (OC-24 confirm-by-typing sheet, OC-25 lifecycle
UI, OC-26 start/stop/restart, OC-27 broadcast all come after this ticket in the backlog). OC-23 is
pure plumbing: the reusable mechanism those tickets will call, not a consumer of it. The mock gateway
already implements the server side fully — `tools/mock-gateway/src/middleware/stepUp.js` requires
`X-Ops-Totp` on every request to a step-up-gated route and validates it against the fixed test code
`'000000'` (same code the login TOTP flow already uses), re-checked on **every** request — the mock
has no server-side "this session recently stepped up" memory.

## What "cached for a short window" can actually mean

This needed real thought before designing the cache, because the naive reading — literally store the
code string the operator typed and resend it for N minutes — doesn't hold up: a TOTP code is a
time-windowed one-time value (~30s step, typically ±1 step of clock-skew tolerance in real
implementations, so realistically valid for something like 60–90s total). A client-side cache that
outlives that window would silently start failing against a *real* TOTP-validating gateway, even
though it would keep "working" against this mock forever (the mock's check is a fixed-string
comparison, not time-aware, so it can't reveal the discrepancy in testing).

There are two structurally different ways "cached" could be real:
1. **Server-side grace window**: providing a valid code once causes the *gateway* to remember, for a
   few minutes, that this session stepped up — subsequent step-up-gated calls in that window don't
   need a fresh code at all. This is how most step-up/sudo-mode systems actually work (GitHub sudo
   mode, `sudo` timestamps, AWS re-auth).
2. **Client-side code replay**: the client remembers the code value and keeps resending it.

The mock implements neither #1 (no session memory) nor is #2 sound for longer than a TOTP code's own
natural validity. Since the mock — not a private, unbuilt gateway repo — is the only ground truth
buildable against right now, and #1 would require a mock change this ticket doesn't have the standing
to also decide the real gateway's future session semantics, this design picks the version of #2 that
is actually honest about what it can promise: **cache the operator-entered code for 90 seconds** — long
enough to cover "the operator fires two related destructive actions back to back" (e.g. Stop, then
immediately Cancel a mis-click) without a second prompt, short enough that the cached value is still
realistically within a real TOTP implementation's own acceptance window, so this isn't inventing a
security promise the underlying mechanism can't back up. If the real gateway ships with the true
server-side grace-window model (#1) later, this cache becomes redundant but harmless — the client
would just be resending a code the server no longer needs, which the server ignores.

`STEP_UP_CACHE_WINDOW_MS = 90_000` — a named, documented, revisitable constant in one place.

## Architecture

Three pieces, following this app's existing patterns exactly:

**1. `src/api/httpClient.ts` — one new opt-in request option.**

```ts
type RequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  stepUpCode?: string;
};
```
In `request()`, alongside the existing header assembly:
```ts
const headers: Record<string, string> = {
  ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
  ...(authHeader ?? {}),
  ...(method !== 'GET' ? { 'Idempotency-Key': deps.generateIdempotencyKey() } : {}),
  ...(options.stepUpCode !== undefined ? { 'X-Ops-Totp': options.stepUpCode } : {}),
};
```
Purely additive, opt-in per call — no existing call site changes behavior. This is the entire surface
a future write-endpoint client (OC-24+) needs to send the header at all; this ticket doesn't add a
`write` API namespace (no endpoint exists to put in it yet — that's each of OC-24 through OC-27's own
job when they build their own mutation).

**2. `src/auth/StepUpContext.tsx` — the cache + prompt orchestration, as a Context/Provider matching
this app's existing pattern (`AuthContext`, `ApiContext`, `StreamContext`, `EnvironmentContext`).**

```tsx
import type { ReactNode } from 'react';
import { createContext, useContext, useRef, useState } from 'react';

import { StepUpPrompt } from './StepUpPrompt';

const STEP_UP_CACHE_WINDOW_MS = 90_000;

type CachedCode = { code: string; obtainedAt: number };

type StepUpContextValue = {
  requestStepUp: (options?: { forceFresh?: boolean }) => Promise<string>;
};

const StepUpContext = createContext<StepUpContextValue | null>(null);

type PendingWaiter = { resolve: (code: string) => void; reject: (error: Error) => void };

export function StepUpProvider({ children }: { children: ReactNode }) {
  const cachedRef = useRef<CachedCode | null>(null);
  // An array, not a single slot: if requestStepUp() is called again while the modal is
  // already open (a double-tap on two different destructive buttons, say), the second
  // caller joins the same in-flight prompt instead of a second modal popping up — both
  // waiters resolve/reject together when the operator finishes the one prompt.
  const pendingRef = useRef<PendingWaiter[]>([]);
  const [promptVisible, setPromptVisible] = useState(false);

  function requestStepUp(options?: { forceFresh?: boolean }): Promise<string> {
    const cached = cachedRef.current;
    if (
      !options?.forceFresh &&
      cached &&
      Date.now() - cached.obtainedAt < STEP_UP_CACHE_WINDOW_MS
    ) {
      return Promise.resolve(cached.code);
    }
    return new Promise((resolve, reject) => {
      pendingRef.current.push({ resolve, reject });
      // No-op if a prompt is already visible — the new waiter still joins the array above.
      setPromptVisible(true);
    });
  }

  function handleSubmit(code: string) {
    cachedRef.current = { code, obtainedAt: Date.now() };
    setPromptVisible(false);
    const waiters = pendingRef.current;
    pendingRef.current = [];
    waiters.forEach((waiter) => waiter.resolve(code));
  }

  function handleCancel() {
    setPromptVisible(false);
    const waiters = pendingRef.current;
    pendingRef.current = [];
    waiters.forEach((waiter) => waiter.reject(new Error('step_up_cancelled')));
  }

  return (
    <StepUpContext.Provider value={{ requestStepUp }}>
      {children}
      <StepUpPrompt visible={promptVisible} onSubmit={handleSubmit} onCancel={handleCancel} />
    </StepUpContext.Provider>
  );
}

export function useStepUpAuth(): StepUpContextValue {
  const value = useContext(StepUpContext);
  if (!value) {
    throw new Error('useStepUpAuth must be used within a StepUpProvider');
  }
  return value;
}
```

A future caller (OC-24+) does:
```ts
const { requestStepUp } = useStepUpAuth();
const code = await requestStepUp();
await api.write.someDestructiveThing({ ...body, stepUpCode: code }); // shape TBD by that ticket
```
and, on a `403 invalid_totp` / `403 step_up_required` response, catches the `ApiError` and calls
`requestStepUp({ forceFresh: true })` to force a new prompt before retrying — this ticket doesn't
build that retry loop (there's no real mutation to attach it to yet), but the interface is shaped so
that ticket doesn't need to touch this file to do it.

A cancelled prompt rejects with a plain `Error('step_up_cancelled')`, not an `ApiError` — it's a user
decision, not a gateway failure. A future caller distinguishes it with
`err.message === 'step_up_cancelled'` (or, more robustly, `err instanceof Error &&
!isApiError(err)`) to abort silently rather than showing an error toast for someone choosing not to
proceed.

**3. `src/auth/StepUpPrompt.tsx` — the modal itself.** Visually mirrors `app/(auth)/totp.tsx`'s
existing 6-digit-code screen (same `TextField`, same `Button`, same copy conventions) since operators
already know that pattern from login — this is the same action (prove you still are who you say you
are), just mid-session instead of at login.

```tsx
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';
import { TextField } from '@/ui/TextField';

export function StepUpPrompt({
  visible,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  onSubmit: (code: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');

  function handleSubmit() {
    onSubmit(code);
    setCode('');
  }

  function handleCancel() {
    setCode('');
    onCancel();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View className="flex-1 items-center justify-center bg-black/60 px-8">
        <View className="w-full max-w-sm gap-4 rounded-lg bg-bg-surface p-6 dark:bg-night-bg-surface">
          <Text
            className="text-xl text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.bold }}
          >
            Confirmá tu identidad
          </Text>
          <Text
            className="text-sm text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            Esta acción requiere tu código TOTP.
          </Text>
          <TextField
            label="Código de 6 dígitos"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoCapitalize="none"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
          />
          <Button
            label="Confirmar"
            onPress={handleSubmit}
            disabled={code.length !== 6}
          />
          <Pressable onPress={handleCancel} accessibilityRole="button">
            <Text
              className="text-center text-sm text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Cancelar
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
```

`Modal`'s `onRequestClose` (Android back button / web Escape-equivalent hardware back handling) is
wired to the same cancel path as the button, not left as a silent no-op — RN warns/requires this prop
on Android.

**4. Mounting.** `StepUpProvider` wraps `app/(tabs)/_layout.tsx`'s content (alongside
`EnvironmentBadge`/`StreamStatusBanner`, which already live there) — step-up is only ever relevant
once authenticated, on an actual destructive-action screen, all of which live under `(tabs)`. It does
NOT go in the root `app/_layout.tsx` (unlike `AuthProvider`/`ApiProvider`/etc., which need to exist
during the unauthenticated `(auth)` flow too) — nothing under `(auth)` ever calls `useStepUpAuth()`.

## Testing

No test runner in this repo, and no real consumer exists yet to exercise end-to-end through the UI —
verification is `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass proving
the full path actually works against the mock's real step-up-gated endpoint
(`POST /api/v1/server/disconnect_all`, chosen because its mock side effect — pushing one harmless log
line, "Todos los jugadores fueron desconectados" — is both real and easy to observe on the already-
shipped Logs screen, with no risk to any other mock state): temporarily wire a throwaway
"Probar step-up" trigger (anywhere convenient, e.g. `/more`) that calls `requestStepUp()` then fires
a raw request carrying the resulting code as `X-Ops-Totp` at that endpoint, confirm the modal appears,
confirm entering `000000` succeeds and the log line shows up on the Logs screen, confirm a second
trigger within 90s does NOT re-show the modal (reuses the cached code, second call still succeeds),
confirm Cancel aborts with no request sent, confirm a deliberately wrong code (e.g. `111111`) gets a
403 `invalid_totp` from the mock (proving the header actually reaches and is checked by the server).
Remove the temporary trigger before committing — it is not this ticket's job to ship a "probar" button,
only to prove the plumbing works. `git diff` at commit time should show no trace of it outside the
three files this design defines.

## Out of scope

- **Any actual destructive-action UI or API call** (start/stop/restart/disconnect-all, ORACLE
  stage/trigger, broadcast) — OC-24 through OC-27's job, not this ticket's.
- **A `write` namespace in `src/api/apiClient.ts`** — nothing to put there yet; each consuming ticket
  adds what it needs when it needs it.
- **Server-side step-up session/grace-window behavior** — not this ticket's call to make for a gateway
  that doesn't exist yet; the client-side 90s cache is deliberately scoped to not assume it.
- **Automatic invalidate-and-retry on a `403 invalid_totp`/`step_up_required` response** — the
  interface (`requestStepUp({ forceFresh: true })`) supports a future caller building this, but there's
  no real mutating call in this ticket to wire the retry loop into.

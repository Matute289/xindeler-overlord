# Step-up Auth (OC-23) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable step-up (TOTP re-prompt) mechanism destructive-action tickets (OC-24
through OC-27, none of which exist yet) will call before firing a mutating request: an opt-in
`X-Ops-Totp` header on `httpClient`, a `useStepUpAuth()` hook that caches a recently-entered code for
a short, TOTP-realistic window, and the modal that collects the code.

**Architecture:** A Context/Provider (`StepUpProvider`/`useStepUpAuth`) matching this app's existing
`AuthContext`/`ApiContext`/`StreamContext`/`EnvironmentContext` pattern, mounted once in
`app/(tabs)/_layout.tsx`. `httpClient.ts` gains one new opt-in `RequestOptions` field. No real
destructive-action call site exists yet — this ticket verifies the mechanism live against the mock
gateway's already-implemented `POST /api/v1/server/disconnect_all` (step-up-gated, side-effect
harmless) via a temporary, reverted-before-commit trigger, not a shipped consumer.

**Tech Stack:** React Context, React Native's built-in `Modal`, this app's existing `TextField`/
`Button` UI primitives.

## Global Constraints

- `STEP_UP_CACHE_WINDOW_MS = 90_000` (90 seconds) — a named constant in
  `src/auth/StepUpContext.tsx`, documented as deliberately short (matches realistic TOTP
  step+clock-skew validity) rather than an arbitrary "a few minutes," since a client-side cache
  longer than a TOTP code's own real validity would silently fail against a real (not mock)
  TOTP-checking gateway. Never re-typed as a bare literal elsewhere.
- The mock gateway's step-up code is `'000000'` (`tools/mock-gateway/src/middleware/stepUp.js`) —
  same value the login TOTP flow already uses (`tools/mock-gateway/src/routes/auth.js`).
- `X-Ops-Totp` is the exact header name (`docs/reference/gateway-api-contract.md` §1) — attached via
  `httpClient.ts`'s `RequestOptions.stepUpCode`, opt-in per call, never sent unless explicitly passed.
- A cancelled prompt rejects with a plain `Error('step_up_cancelled')`, never an `ApiError` — it's a
  user decision, not a gateway failure.
- `StepUpProvider` mounts in `app/(tabs)/_layout.tsx` only — never the root `app/_layout.tsx`. Nothing
  under `(auth)` calls `useStepUpAuth()`.
- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check`, plus the live pass described per task.

---

### Task 1: `httpClient.ts` — opt-in `X-Ops-Totp` header

**Files:**
- Modify: `src/api/httpClient.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `RequestOptions.stepUpCode?: string` — consumed by Task 2's live-verification harness
  (temporary, not shipped) and by future tickets (OC-24+) building real mutating calls.

- [ ] **Step 1: Add `stepUpCode` to `RequestOptions` and attach the header when present**

Read the current file first — confirm it still matches. Current `RequestOptions` type and header
assembly (`src/api/httpClient.ts:15-19,33-37`):
```ts
type RequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
};
```
```ts
      const authHeader = await deps.getAuthHeader();
      const headers: Record<string, string> = {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(authHeader ?? {}),
        ...(method !== 'GET' ? { 'Idempotency-Key': deps.generateIdempotencyKey() } : {}),
      };
```

Change to:
```ts
type RequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  stepUpCode?: string;
};
```
```ts
      const authHeader = await deps.getAuthHeader();
      const headers: Record<string, string> = {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(authHeader ?? {}),
        ...(method !== 'GET' ? { 'Idempotency-Key': deps.generateIdempotencyKey() } : {}),
        ...(options.stepUpCode !== undefined ? { 'X-Ops-Totp': options.stepUpCode } : {}),
      };
```
Nothing else in the file changes — `request()`'s body, `requestWithRetry()`, and every existing call
site are unaffected (the new field is optional and unused unless a caller passes it).

- [ ] **Step 2: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/api/httpClient.ts
git commit -m "feat(oc23): opt-in X-Ops-Totp header on httpClient requests"
```

---

### Task 2: `StepUpContext` + `StepUpPrompt` + mounting + live verification

**Files:**
- Create: `src/auth/StepUpContext.tsx`
- Create: `src/auth/StepUpPrompt.tsx`
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `TextField` (`@/ui/TextField`), `Button` (`@/ui/Button`), `fonts` (`@/ui/theme`) — all
  already exist. Task 1's `RequestOptions.stepUpCode` (used only by this task's temporary
  verification harness, not by any shipped file).
- Produces: `StepUpProvider({children}): JSX.Element`, `useStepUpAuth(): { requestStepUp: (options?:
  { forceFresh?: boolean }) => Promise<string> }` — both exported from `src/auth/StepUpContext.tsx`.
  No task in this plan consumes them further (no OC-24+ work exists yet) — they're the ticket's
  entire deliverable.

- [ ] **Step 1: Write `src/auth/StepUpPrompt.tsx`**

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
          <Button label="Confirmar" onPress={handleSubmit} disabled={code.length !== 6} />
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

- [ ] **Step 2: Write `src/auth/StepUpContext.tsx`**

```tsx
import type { ReactNode } from 'react';
import { createContext, useContext, useRef, useState } from 'react';

import { StepUpPrompt } from './StepUpPrompt';

// Deliberately short — see docs/specs/2026-08-14-step-up-auth-design.md's "What 'cached for a
// short window' can actually mean" section. A client-side cache longer than a real TOTP code's
// own validity (~30s step + clock-skew tolerance) would silently fail against a real gateway
// even though it "works" forever against the mock's fixed-string check.
const STEP_UP_CACHE_WINDOW_MS = 90_000;

type CachedCode = { code: string; obtainedAt: number };
type PendingWaiter = { resolve: (code: string) => void; reject: (error: Error) => void };

type StepUpContextValue = {
  requestStepUp: (options?: { forceFresh?: boolean }) => Promise<string>;
};

const StepUpContext = createContext<StepUpContextValue | null>(null);

export function StepUpProvider({ children }: { children: ReactNode }) {
  const cachedRef = useRef<CachedCode | null>(null);
  // An array, not a single slot: if requestStepUp() is called again while the modal is already
  // open (e.g. a double-tap on two destructive buttons), the second caller joins the same
  // in-flight prompt instead of a second modal popping up — both waiters resolve/reject
  // together when the operator finishes the one prompt.
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

- [ ] **Step 3: Mount `StepUpProvider` in `app/(tabs)/_layout.tsx`**

Read the current file first — confirm it still matches. Current relevant section
(`app/(tabs)/_layout.tsx:1-9,27-35`):
```tsx
import { Ionicons } from '@expo/vector-icons';
import { Link, Slot, Tabs, usePathname } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StreamStatusBanner } from '@/features/connectivity/StreamStatusBanner';
import { EnvironmentBadge } from '@/features/environment/EnvironmentBadge';
import { useBreakpoint } from '@/ui/useBreakpoint';
import { fonts, useTheme } from '@/ui/theme';
```
```tsx
export default function TabsLayout() {
  const breakpoint = useBreakpoint();
  const { colors } = useTheme();

  return (
    <View className="flex-1">
      <EnvironmentBadge />
      <StreamStatusBanner />
      <View className="flex-1">
```

Change to (add the import, wrap the existing returned tree in `<StepUpProvider>`):
```tsx
import { Ionicons } from '@expo/vector-icons';
import { Link, Slot, Tabs, usePathname } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StepUpProvider } from '@/auth/StepUpContext';
import { StreamStatusBanner } from '@/features/connectivity/StreamStatusBanner';
import { EnvironmentBadge } from '@/features/environment/EnvironmentBadge';
import { useBreakpoint } from '@/ui/useBreakpoint';
import { fonts, useTheme } from '@/ui/theme';
```
```tsx
export default function TabsLayout() {
  const breakpoint = useBreakpoint();
  const { colors } = useTheme();

  return (
    <StepUpProvider>
      <View className="flex-1">
        <EnvironmentBadge />
        <StreamStatusBanner />
        <View className="flex-1">
```
This means the function's closing tags gain one more level of nesting — the existing `</View></View>`
at the end of the component's returned JSX (just before the final `);`) becomes
`</View></View></StepUpProvider>`. `SidebarLayout` (the second function in this file) is untouched —
`StepUpProvider` wraps the outer `TabsLayout` return, which already contains `SidebarLayout` via
`Tabs`/`Slot`, so nothing there needs its own wrapping.

- [ ] **Step 4: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: no new errors.

- [ ] **Step 5: Live verification against the mock's real step-up-gated endpoint**

No real consumer of `useStepUpAuth()` exists yet, so this step proves the mechanism end-to-end with a
**temporary** trigger you add, exercise, and then fully remove before committing — `git diff` at
commit time must show no trace of it outside the files this task already creates/modifies.

Prerequisite: `npm run mock-gateway` running, `npx expo start --web` running, logged in.

Temporarily add a button anywhere convenient (e.g. `app/(tabs)/more.tsx`, right above the existing
"Cerrar sesión" button) that, on press:
```tsx
async function testStepUp() {
  const code = await requestStepUp();
  const response = await fetch(`${environment.baseUrl}/api/v1/server/disconnect_all`, {
    method: 'POST',
    headers: { 'X-Ops-Totp': code, 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  console.log('[step-up test]', response.status);
}
```
(needs `useStepUpAuth()` and `useEnvironment()` imported temporarily into that file for this test
only — both already exist).

Drive it through this sequence, confirming each result before moving to the next:
1. Tap the test button. Confirm the `StepUpPrompt` modal appears (title, 6-digit field, Confirmar
   disabled until 6 digits entered, Cancelar link).
2. Type `000000`, tap Confirmar. Confirm the modal closes and the console logs `200`. Navigate to the
   Logs tab and confirm a new `warn`-level line "Todos los jugadores fueron desconectados" appears —
   this is the mock's real, observable side effect for this endpoint, proof the header actually
   reached and was accepted by the server.
3. Tap the test button again immediately (within 90 seconds). Confirm the modal does **not**
   reappear — the cached code is reused — and the console still logs `200` (a second disconnect_all
   log line appears in Logs).
4. Tap the test button, this time tap **Cancelar** instead of confirming. Confirm no `fetch` fires (no
   new console log line, no new Logs entry) — the promise rejected before reaching the `fetch` call.
5. Force a fresh prompt to test the rejection path: temporarily change the test button's code to call
   `requestStepUp({ forceFresh: true })`, tap it, and type a wrong code (`111111`) before confirming.
   Confirm the console logs `403` (the mock's `invalid_totp` response) — proof a wrong code is
   actually rejected server-side, not silently accepted client-side.

Remove the temporary button, its handler, and its temporary imports from `more.tsx` entirely once all
five checks pass. Confirm `git diff` shows no changes to `app/(tabs)/more.tsx` at commit time.

- [ ] **Step 6: Update `docs/backlog.md`'s OC-23 row**

Change the row's status cell from `⬜` to `✅` and describe what shipped: the `httpClient.ts`
`X-Ops-Totp` opt-in header, the `StepUpProvider`/`useStepUpAuth()` mechanism and its 90-second
cache window (briefly note why 90s, not an arbitrary longer "a few minutes" — ties to real TOTP
validity), the `StepUpPrompt` modal, where it's mounted (`(tabs)` layout only), and the live
verification performed against the mock's `disconnect_all` endpoint (all 5 checks from Step 5). Note
explicitly that no real destructive-action screen consumes this yet — OC-24 through OC-27 will.
Match the terse, factual style of the existing OC-13 through OC-22 rows in that file.

- [ ] **Step 7: Commit**

```bash
git add src/auth/StepUpContext.tsx src/auth/StepUpPrompt.tsx "app/(tabs)/_layout.tsx" docs/backlog.md
git commit -m "feat(oc23): step-up auth mechanism (StepUpProvider, useStepUpAuth, StepUpPrompt)"
```

---

## Self-Review

**Spec coverage:**
- "Architecture" §1 (`httpClient.ts` opt-in header) → Task 1. ✅
- "Architecture" §2 (`StepUpContext.tsx`) → Task 2 Step 2. ✅
- "Architecture" §3 (`StepUpPrompt.tsx`) → Task 2 Step 1. ✅
- "Architecture" §4 (mounting in `(tabs)` layout, not root) → Task 2 Step 3. ✅
- "Testing" (live pass against `disconnect_all`, temporary/reverted) → Task 2 Step 5. ✅
- "Out of scope" (no destructive UI, no `write` namespace, no server-side session semantics, no
  auto-retry loop) — no task builds any of these. ✅

**Placeholder scan:** No TBD/TODO. Every code step has literal, complete code, including the
temporary verification harness (spelled out fully so its later removal is unambiguous — nothing
vague like "add a test button").

**Type consistency:** `RequestOptions.stepUpCode?: string` (Task 1) is consumed identically by the
Step 5 verification harness's `fetch` call (as a plain header value, not re-threaded through
`httpClient` itself, since the test intentionally exercises the raw contract rather than adding a new
shipped API-client method). `requestStepUp(options?: { forceFresh?: boolean }): Promise<string>` is
defined once in Task 2 Step 2 and consumed identically by Step 5's harness. `StepUpPrompt`'s
`{visible, onSubmit, onCancel}` props are defined in Step 1 and consumed identically by
`StepUpContext.tsx`'s `<StepUpPrompt visible={promptVisible} onSubmit={handleSubmit}
onCancel={handleCancel} />` in Step 2 — no mismatch.

# ORACLE Chat "Mock Only" Notice (OC-51) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn the operator, precisely and only when relevant, that "Chat con ORACLE" only
responds against the `Mock` environment — the real gateway has no Bedrock implementation yet.

**Architecture:** A conditional note (`environment.id !== 'mock'`) added to two existing screens —
no new components, no new state, no backend/API changes.

**Tech Stack:** TypeScript, React Native (Expo).

## Global Constraints

- No test runner exists in this repo — verification is `npx tsc --noEmit` / `npm run lint` /
  `npm run format:check`, plus a live pass.
- No controls are disabled anywhere — this is pure informational copy, not a greyed-out feature.
- No gateway-side change.

---

## Task 1: Conditional notice on both ORACLE screens

**Files:**
- Modify: `src/features/oracle/OracleEventsScreen.tsx` (the "Chat con ORACLE" `Link` block)
- Modify: `src/features/oracleChat/OracleChatScreen.tsx` (the header block)

**Interfaces:**
- Consumes: `useEnvironment()` (`src/config/EnvironmentContext.tsx`) — `{ environment: { id:
  'mock' | 'wireguard'; label: string; baseUrl: string }; setEnvironment: ... }`. Neither file
  currently imports this hook — both gain the import.

- [ ] **Step 1: Add the conditional notice to `src/features/oracle/OracleEventsScreen.tsx`**

Add the import (alongside the existing `@/api/ApiContext` import near the top):

```tsx
import { useEnvironment } from '@/config/EnvironmentContext';
```

Add the hook call inside `OracleEventsScreen()`, alongside the existing `useTheme()`/`useApi()`
calls:

```tsx
  const { environment } = useEnvironment();
```

Find the "Chat con ORACLE" `Link` block:

```tsx
      <Link href="/oracle-chat" asChild>
        <Pressable
          accessibilityRole="button"
          className="mx-6 mt-2 flex-row items-center justify-between rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark"
        >
          <Text
            className="text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.semibold }}
          >
            Chat con ORACLE
          </Text>
          <Ionicons name="chevron-forward-outline" color={colors.textMuted} size={18} />
        </Pressable>
      </Link>
```

Replace with (adds a conditional note directly below the row, matching the existing "Si un evento
queda acá mucho tiempo…" note's placement/styling pattern used lower on this same screen — muted
text, `mt-2 px-6`, `fonts.regular`, `text-xs`):

```tsx
      <Link href="/oracle-chat" asChild>
        <Pressable
          accessibilityRole="button"
          className="mx-6 mt-2 flex-row items-center justify-between rounded-lg border border-steel-dark px-4 py-3 dark:border-night-steel-dark"
        >
          <Text
            className="text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.semibold }}
          >
            Chat con ORACLE
          </Text>
          <Ionicons name="chevron-forward-outline" color={colors.textMuted} size={18} />
        </Pressable>
      </Link>
      {environment.id !== 'mock' && (
        <View className="mt-2 px-6">
          <Text
            className="text-xs text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            El chat todavía no tiene implementación en el gateway real — solo responde contra el
            entorno Mock (falta Bedrock del lado del gateway).
          </Text>
        </View>
      )}
```

- [ ] **Step 2: Add the conditional notice to `src/features/oracleChat/OracleChatScreen.tsx`**

Add the import (alongside the existing `@/api/schemas` import near the top):

```tsx
import { useEnvironment } from '@/config/EnvironmentContext';
```

Add the hook call inside `OracleChatScreen()`, alongside the existing
`useOracleChatThreads()`/`useOracleBudgetQuery()` calls:

```tsx
  const { environment } = useEnvironment();
```

Find the header block:

```tsx
      <View className="flex-row items-center justify-between px-6 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Chat con ORACLE
        </Text>
        <FollowTailToggle followTail={followTail} onToggle={toggleFollowTail} />
      </View>
```

Replace with (same conditional note, added directly below the header row):

```tsx
      <View className="flex-row items-center justify-between px-6 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Chat con ORACLE
        </Text>
        <FollowTailToggle followTail={followTail} onToggle={toggleFollowTail} />
      </View>
      {environment.id !== 'mock' && (
        <View className="px-6 pt-1">
          <Text
            className="text-xs text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            El chat todavía no tiene implementación en el gateway real — solo responde contra el
            entorno Mock (falta Bedrock del lado del gateway).
          </Text>
        </View>
      )}
```

- [ ] **Step 3: Type-check, lint, format**

Run: `npx tsc --noEmit` — expect 0 errors.
Run: `npm run lint` — expect 0 errors (pre-existing warning count unchanged).
Run: `npm run format:check` — expect clean.

- [ ] **Step 4: Live-verify**

Run `npm run mock-gateway` + `npx expo start --web`. Log in (default environment is `Mock`).
Confirm: (1) neither screen shows the notice on `Mock`; (2) switch to `WireGuard` via
`EnvironmentSwitcher` (in `Más`) — the ORACLE screen's "Chat con ORACLE" row now shows the notice
below it; (3) if the chat screen is opened while on `WireGuard`, it shows the notice at the top
too; (4) switching back to `Mock` makes both notices disappear again; (5) nothing is disabled —
"Enviar"/"Pensar mejor" and the entry-point link remain fully tappable regardless of environment
(they'll just fail against `WireGuard` with a real network/gateway error, which is expected and
out of this ticket's scope to change).

- [ ] **Step 5: Commit**

```bash
git add src/features/oracle/OracleEventsScreen.tsx src/features/oracleChat/OracleChatScreen.tsx
git commit -m "feat(oc51): warn when ORACLE chat is used outside the Mock environment"
```

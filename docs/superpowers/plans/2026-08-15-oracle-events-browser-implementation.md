# ORACLE Events/Templates Browser (OC-29) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ORACLE tab's Phase-3 placeholder with a real, read-only browser of staged/loaded
`DmEvent` ids and available `EntityTemplate`s — the first Phase 3 ticket, and the first real ORACLE
content in this app.

**Architecture:** A plain bootstrap-only TanStack Query hook (no stream involvement — there's no
`oracle` SSE event and nothing in this ticket triggers a live change yet), a pull-to-refresh screen
matching `PlayersScreen`'s established shape, and one new schema/read-API method mirroring every
other read endpoint this app already has.

**Tech Stack:** Existing TanStack Query / `GatewayErrorEmpty` infrastructure — no new dependencies.

## Global Constraints

- `GET /api/v1/oracle/events` response shape (confirmed against `tools/mock-gateway/src/routes/
  oracleEvents.js`, the concrete source of truth — the contract doc doesn't spell out the exact JSON):
  `{ staged: string[], loaded: string[], entity_templates: { id: string, name: string }[] }`.
- No SSE/polling mechanism — bootstrap fetch + manual pull-to-refresh only. Do not invent a polling
  loop; nothing in this ticket triggers a live transition to poll for.
- The UI must never show a "failed" status — the contract has no such bucket. A `staged` id that
  lingers is ambiguous (still in flight, or silently parse-failed) and the screen says so once, in
  one small note, rather than guessing.
- All three sections (Cargados/En etapa/Templates) render even when empty, with their own "Sin X"
  text — never hide an empty section.
- This repo has zero default `React` imports — always `import { x } from 'react'`, never
  `import React from 'react'`.
- Prettier: single quotes, semicolons, trailing commas everywhere, 100-column width. Path alias `@/`
  maps to `src/`.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check`, plus the live pass in Step 6.

---

### Task 1: Schema + read API + hook + screen + route + live verify + backlog

**Files:**
- Modify: `src/api/schemas.ts`
- Modify: `src/api/readApi.ts`
- Modify: `src/api/queryClient.ts`
- Create: `src/features/oracle/useOracleEventsQuery.ts`
- Create: `src/features/oracle/OracleEventsScreen.tsx`
- Modify: `app/(tabs)/oracle.tsx`
- Modify: `docs/backlog.md`

**Interfaces:**
- Consumes: `useApi` (`@/api/ApiContext`); `useAuthErrorRouting` (`@/auth/useAuthErrorRouting`);
  `GatewayErrorEmpty`/`Empty` (already exist); `fonts`/`useTheme` (`@/ui/theme`); `Screen`
  (`@/ui/Screen`).
- Produces: `OracleEventsResponseSchema`/`type OracleEventsResponse`/`EntityTemplateSchema`/`type
  EntityTemplate` (`@/api/schemas`); `api.read.getOracleEvents()`; `queryKeys.oracleEvents`;
  `useOracleEventsQuery()`; `OracleEventsScreen()` — none consumed by a later task in this plan, this
  is the only task.

- [ ] **Step 1: Add schemas to `src/api/schemas.ts`**

Add near the end of the file, after `AuditRowSchema`/`AuditResponseSchema` and before the
`LifecycleEventSchema` block (or wherever fits the file's existing grouping — read the current file
first to place it sensibly among the other response schemas):

```ts
export const EntityTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type EntityTemplate = z.infer<typeof EntityTemplateSchema>;

export const OracleEventsResponseSchema = z.object({
  staged: z.array(z.string()),
  loaded: z.array(z.string()),
  entity_templates: z.array(EntityTemplateSchema),
});
export type OracleEventsResponse = z.infer<typeof OracleEventsResponseSchema>;
```

- [ ] **Step 2: Add `getOracleEvents` to `src/api/readApi.ts`**

Read the current file first. Add the import (`OracleEventsResponseSchema` alongside the file's
existing schema imports) and the method inside the returned object, alongside the other five:

```ts
getOracleEvents() {
  return http.requestWithRetry('/api/v1/oracle/events', { method: 'GET' }, OracleEventsResponseSchema);
},
```

- [ ] **Step 3: Add `oracleEvents` to `src/api/queryClient.ts`'s `queryKeys`**

Read the current file first. Add one entry to the `queryKeys` object, alongside `status`/`players`/
`logs`/`chat`/`chronicle`/`audit`:

```ts
oracleEvents: ['oracleEvents'] as const,
```

- [ ] **Step 4: Write `src/features/oracle/useOracleEventsQuery.ts`**

```ts
import { useQuery } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';
import { useAuthErrorRouting } from '@/auth/useAuthErrorRouting';

export function useOracleEventsQuery() {
  const api = useApi();

  const query = useQuery({
    queryKey: queryKeys.oracleEvents,
    queryFn: () => api.read.getOracleEvents(),
  });

  useAuthErrorRouting(query.error);

  return query;
}
```

No `refetchOnWindowFocus`/`refetchOnMount` overrides — unlike Logs/Chat/Audit's stream-owned caches,
this one has no stream writing into it, so the normal TanStack default behavior (refetch on focus/
remount) is correct here, not something to suppress.

- [ ] **Step 5: Write `src/features/oracle/OracleEventsScreen.tsx`**

```tsx
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { Empty } from '@/ui/Empty';
import { fonts, useTheme } from '@/ui/theme';

import { useOracleEventsQuery } from './useOracleEventsQuery';

function Section({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: string[];
  emptyText: string;
}) {
  return (
    <View className="mt-6 px-6">
      <Text
        className="text-sm text-steel-muted dark:text-night-steel-muted"
        style={{ fontFamily: fonts.semibold }}
      >
        {`${title} (${items.length})`}
      </Text>
      {items.length === 0 ? (
        <Text
          className="mt-2 text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {emptyText}
        </Text>
      ) : (
        items.map((item) => (
          <Text
            key={item}
            className="mt-2 text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.regular }}
          >
            {item}
          </Text>
        ))
      )}
    </View>
  );
}

export function OracleEventsScreen() {
  const query = useOracleEventsQuery();
  const { colors } = useTheme();
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setIsRefreshing(false);
    }
  }

  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="ORACLE" error={query.error} />;
    }
    return <Empty title="ORACLE" message="Cargando…" />;
  }

  const { staged, loaded, entity_templates: entityTemplates } = query.data;

  return (
    <ScrollView
      className="flex-1"
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
      }
    >
      <View className="px-6 pt-8">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          ORACLE
        </Text>
      </View>
      <Section title="Cargados" items={loaded} emptyText="Sin eventos cargados." />
      <Section title="En etapa" items={staged} emptyText="Nada en etapa." />
      {staged.length > 0 && (
        <View className="mt-2 px-6">
          <Text
            className="text-xs text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            Si un evento queda acá mucho tiempo, puede seguir en curso o haber fallado el parseo — hoy
            el gateway no distingue entre ambos casos.
          </Text>
        </View>
      )}
      <Section
        title="Templates disponibles"
        items={entityTemplates.map((template) => template.name)}
        emptyText="Sin templates."
      />
      <View className="h-8" />
    </ScrollView>
  );
}
```

- [ ] **Step 6: Replace `app/(tabs)/oracle.tsx`**

Read the current file first — confirm it still matches:
```tsx
import { Empty } from '@/ui/Empty';
import { Screen } from '@/ui/Screen';

export default function OracleScreen() {
  return (
    <Screen>
      <Empty title="ORACLE" message="El control manual de ORACLE llega en la Fase 3." />
    </Screen>
  );
}
```

Replace with:
```tsx
import { OracleEventsScreen } from '@/features/oracle/OracleEventsScreen';
import { Screen } from '@/ui/Screen';

export default function OracleRoute() {
  return (
    <Screen>
      <OracleEventsScreen />
    </Screen>
  );
}
```

- [ ] **Step 7: Typecheck, lint, and format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

- [ ] **Step 8: Live verification**

Prerequisite: `npm run mock-gateway` running, `npx expo start --web` running, logged in.

1. Navigate to the ORACLE tab. Confirm it now shows the three sections (Cargados/En etapa/Templates
   disponibles) instead of the old placeholder, all three empty ("Sin eventos cargados.", "Nada en
   etapa.", and the three fixture templates — "Manada de lobos", "Campamento de bandidos", "Elemental
   de tormenta" — actually populated, since `entity_templates` is a static fixture always returned).
2. Populate test data via a TEMPORARY trigger (same "add, verify, revert before commit" discipline as
   OC-23/24): temporarily add a button anywhere convenient (e.g. `app/(tabs)/more.tsx`) that fires a
   raw `fetch` (or reuses `useApi()` if easier) directly at the mock's real
   `POST /api/v1/oracle/stage` with a body like
   `{ id: 'test_event', dm_event: { kind: 'spawn', template_id: 'tpl_wolf_pack', intensity: 1, radius: 5 } }`.
   Tap it, then IMMEDIATELY navigate to ORACLE and pull-to-refresh — confirm `test_event` appears
   under "En etapa" and the honesty note is now visible. Wait ~2 seconds (the mock's internal staging
   delay) and pull-to-refresh again — confirm `test_event` has moved to "Cargados" and disappeared
   from "En etapa" (note is gone too, since staged is now empty again).
3. Confirm the loading state (`Cargando…`) is visible briefly on a hard reload, and the error state
   (temporarily point the environment at an unreachable port, same technique prior tickets used, if
   you want to exercise it — otherwise code review of the identical `GatewayErrorEmpty` pattern used
   by every other screen is sufficient here, note which approach you took).

Remove the temporary trigger, its handler, and any temporary imports entirely once verification
passes. Confirm `git diff` shows no changes to whichever file you used for the trigger at commit time.

- [ ] **Step 9: Update `docs/backlog.md`'s OC-29 row**

Change the row's status cell from `⬜` to `✅` and describe what shipped: the schema/read-API/hook/
screen, the "no invented failed status, no invented polling" reasoning (both tied to what the current
contract actually provides and to nothing in this ticket needing a live-update mechanism), and the
live verification performed. Note explicitly this is Phase 3's first ticket and what's still ahead
(OC-30 presets, OC-31 composer, OC-32 target picker, OC-33 dry-run, OC-34 fire + kill switch). Match
the terse, factual style of the existing OC-13 through OC-28 rows.

- [ ] **Step 10: Commit**

```bash
git add src/api/schemas.ts src/api/readApi.ts src/api/queryClient.ts src/features/oracle "app/(tabs)/oracle.tsx" docs/backlog.md
git commit -m "feat(oc29): oracle events/templates browser"
```

---

## Self-Review

**Spec coverage:** The schema, read API, hook, screen (all three sections, the honesty note, empty
states), the route swap, and the live-verification plan are all covered by this single task. "Out of
scope" items (staging/firing/composer/presets/target-picker/kill-switch, any polling/SSE mechanism, a
"failed" status) — nothing in this plan builds any of them. ✅

**Placeholder scan:** No TBD/TODO — full literal code throughout, including the exact temporary
verification trigger's request body.

**Type consistency:** `OracleEventsResponseSchema`'s inferred type (`{staged: string[], loaded:
string[], entity_templates: {id, name}[]}`) is consumed identically in `OracleEventsScreen.tsx` via
`query.data` destructuring (`staged`, `loaded`, `entity_templates: entityTemplates`) — matches the
schema field names exactly (the rename to `entityTemplates` is purely a local variable name, not a
type mismatch). `Section`'s `items: string[]` prop is fed `loaded`/`staged` directly (already
`string[]`) and `entityTemplates.map((t) => t.name)` (mapped to `string[]`) — consistent.

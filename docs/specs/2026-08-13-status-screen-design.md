# Status screen (OC-18) — design

**Status:** Two decisions were explicitly confirmed by Matías before writing this spec (not authored
unilaterally, unlike most of this session's other specs, since he was actively present rather than
asleep): (1) build the TanStack Query data layer the original client architecture spec (§4) called
for, rather than continuing the hand-rolled Context pattern OC-13–17 used — "tenemos tiempo, y
conviene construir algo robusto y fuerte desde el principio"; (2) confirmed explicitly a second time
("vayamos con la segunda opción") after seeing the trade-off laid out. Everything below this point —
the exact file layout, query-key conventions, and the screen's own UI — is again an implementation-
structure decision, not a further product question.

## Why this decision matters now, not later

`docs/specs/2026-08-09-client-architecture-design.md` §4 says: "TanStack Query owns everything the
gateway is the source of truth for. React context owns session and config. There is no global store;
if one becomes necessary, that is a signal the SSE stream is being used wrong." OC-13 through OC-17
never installed it — every context built so far (`EnvironmentContext`, `AuthContext`, `StreamContext`)
is hand-rolled `useState`/`useEffect`, because none of them needed a caching layer (auth state and
environment config aren't "data the gateway owns," they're client-side session/config state). OC-18
is the first screen that reads gateway-owned data, so this is genuinely the first point in the
codebase where the original spec's call and the actually-shipped pattern would diverge if left
unaddressed — worth resolving explicitly rather than let OC-18 default into whichever pattern its
implementer happens to reach for, and having OC-19–21/28 either copy a decision nobody actually made
or need to redo it.

## Scope

`docs/backlog.md`'s OC-18 row: "The headline screen: up/down, uptime, version, players online, tick
time, entity/chunk counts, pending shutdown. Live via SSE, never a 1 Hz full refresh." Building:

1. **The TanStack Query foundation** — `src/api/queryClient.ts` (the `QueryClient` singleton + a
   `queryKeys` naming convention covering every read endpoint, not just `status`, so OC-19–21/28
   don't each invent their own), `src/api/QueryProvider.tsx` (React Native's `focusManager`/
   `onlineManager` wiring, mounted at the app root), and `src/api/ApiContext.tsx` (`useApi()` — the
   authenticated `ApiClient` instance, rebuilt on environment switch, mirroring `StreamContext.tsx`'s
   exact `useMemo` shape). This is infrastructure every future data screen reuses, the same
   relationship OC-17's `StreamClient`/`StreamContext` has to OC-18 itself.
2. **The Status screen** (`app/(tabs)/index.tsx` + `src/features/status/`) — bootstraps via one REST
   `GET /api/v1/status` call (`useQuery`), then stays live via the stream's `status` event, which
   writes straight into the query cache (`queryClient.setQueryData`) instead of triggering a refetch
   — the mechanism that makes "never a 1 Hz full refresh" true by construction rather than by
   discipline.

**Not in scope:** `lifecycle`-driven UI (OC-25's state machine, Phase 2) — confirmed below that
`status`'s own `pending_shutdown` field already covers everything OC-18 needs to *display*, since the
mock broadcasts `status` and `lifecycle` together on every draining tick (`scenarios.js`'s
`beginGracefulStop`). OC-25 is where a `Stack.Protected`-style state-machine UI (with a reachable
Cancel button through the whole drain) actually needs the `lifecycle` event's own semantics.
Players/logs/chat/audit screens (OC-19–21, OC-28) — this spec's foundation section is built for them
to reuse, but building them is out of scope here.

## Foundation: the TanStack Query data layer

### `src/api/queryClient.ts`

```ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient();

// One key per gateway read endpoint, defined now so every future screen (OC-19 players, OC-20
// logs, OC-21 chat, OC-28 audit) reuses the same convention instead of inventing its own. Params
// that vary a query's actual request (limit, since) are part of the key, per TanStack's own
// query-key rules — a different `limit` is a different cached entry.
export const queryKeys = {
  status: ['status'] as const,
  players: ['players'] as const,
  logs: (limit?: number) => ['logs', limit] as const,
  chat: (since?: string) => ['chat', since] as const,
  chronicle: (limit?: number) => ['chronicle', limit] as const,
  audit: (limit?: number) => ['audit', limit] as const,
};
```

A plain singleton, not a context value — `QueryClient` itself has no dependency on `environment`
(unlike `ApiClient`, whose base URL changes), so there's nothing to rebuild on an environment switch.
What *does* need to happen on a switch is discarding any cached data from the old environment — see
`ApiContext.tsx` below.

### `src/api/QueryProvider.tsx`

```tsx
import { focusManager, onlineManager, QueryClientProvider } from '@tanstack/react-query';
import * as Network from 'expo-network';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import type { AppStateStatus } from 'react-native';

import { queryClient } from './queryClient';

function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== 'web') {
    focusManager.setFocused(status === 'active');
  }
}

// expo-network over @react-native-community/netinfo — this repo already prefers Expo-managed
// packages over generic RN community ones for anything Expo itself ships (expo-crypto for UUIDs,
// expo-secure-store for the session, now this) — one less native module to manage the lifecycle of.
onlineManager.setEventListener((setOnline) => {
  let initialised = false;
  const subscription = Network.addNetworkStateListener((state) => {
    initialised = true;
    setOnline(!!state.isConnected);
  });
  Network.getNetworkStateAsync()
    .then((state) => {
      if (!initialised) setOnline(!!state.isConnected);
    })
    .catch(() => {});
  return subscription.remove;
});

export function QueryProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', onAppStateChange);
    return () => subscription.remove();
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

This is TanStack's own documented React Native recipe (`focusManager` via `AppState`, `onlineManager`
via a network-state listener), not a bespoke pattern — worth keeping close to the source so future
upgrades track upstream guidance rather than a local reinterpretation of it. `onlineManager`'s
listener is registered at module scope (once, like the `queryClient` singleton itself), not inside
the component — matches TanStack's own recipe and avoids re-registering a global listener on every
mount.

**Why a second, independent `AppState` listener rather than reusing `StreamContext`'s existing one:**
each concern (the stream's own reconnect-on-foreground, TanStack's stale-query refetch-on-foreground)
owns its listener — consistent with this codebase's existing style of small, single-purpose effects
rather than one shared "foreground" event bus. `AppState.addEventListener` supports any number of
listeners; there's no coordination cost to keeping them separate.

### `src/api/ApiContext.tsx`

```tsx
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo } from 'react';

import { useEnvironment } from '@/config/EnvironmentContext';

import { createApiClient, type ApiClient } from './apiClient';
import { queryClient } from './queryClient';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const { environment } = useEnvironment();

  const api = useMemo(() => createApiClient(environment.baseUrl), [environment.baseUrl]);

  // Cached data from one environment is meaningless (and actively misleading) once the operator
  // switches to another — an environment switch already forces a logout (AuthContext's own
  // baseUrl effect), so treat it the same way here: drop everything this client ever cached.
  // Skip the very first render, matching AuthContext's own isFirstRender guard for the identical
  // reason — that's the boot-time environment value, not a real switch.
  useEffect(() => {
    queryClient.clear();
  }, [api]);

  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) {
    throw new Error('useApi must be used within an ApiProvider');
  }
  return api;
}
```

Deliberately its **own** context rather than added to `AuthContextValue` — `api/` and `auth/` are
separate layers in `CLAUDE.md`'s layering rule for a reason (auth owns *whether* there's a session,
not the REST client built on top of one), and `AuthContext` already builds its own private
`createApiClient` instance for `login`/`totp`/`logout`. Two independent instances cost nothing
(`createApiClient` is a pure factory closing over nothing shared/mutable), and keeping them separate
means `api/` doesn't reach into `auth/`'s internals or vice versa.

**A note on the `useEffect`'s dependency array** (`[api]`, not `[environment.baseUrl]`): `api` is
already `useMemo`'d on `environment.baseUrl`, so a new `api` instance *is* the signal a switch
happened — depending on the derived value here rather than duplicating the same condition twice
keeps the two effects (this one, and `useMemo`'s own recomputation) from being able to disagree.
Unlike `AuthContext`'s analogous effect, this one does *not* need an `isFirstRender` guard: clearing
an empty cache on the very first render is a no-op, whereas `AuthContext`'s equivalent effect clears
a *real, freshly-restored session* if it fires on mount — the two effects look similar but guard
against different things.

`app/_layout.tsx` gains `ApiProvider` and `QueryProvider` alongside the existing three:
`EnvironmentProvider > AuthProvider > ApiProvider > QueryProvider > StreamProvider > (StatusBar +
RootNavigator)`. `ApiProvider` only needs `EnvironmentProvider` (not `AuthProvider`) but nesting it
inside `AuthProvider` costs nothing and keeps the provider list's ordering readable as "config →
session → data client → data cache → live transport" rather than interleaving unrelated layers.
`QueryProvider` has no dependency on anything above it in this list (`queryClient` is a module-level
singleton) but must wrap anything using `useQuery`, i.e. everything under it.

## The Status screen

### `src/features/status/useStatusQuery.ts`

```ts
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '@/api/ApiContext';
import { queryKeys } from '@/api/queryClient';
import { useStreamEvent } from '@/stream/StreamContext';

export function useStatusQuery() {
  const api = useApi();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.status,
    queryFn: () => api.read.getStatus(),
  });

  // The stream's `status` event is byte-for-byte the same shape as this query's own response
  // (contract §3.1: "same shape as GET /status") — write it straight into the cache instead of
  // calling `refetch()`. This is what makes "live via SSE, never a 1 Hz full refresh" literally
  // true: the only REST call this screen ever makes is the one bootstrap fetch above (plus
  // TanStack's own default retry-on-failure and refetch-on-reconnect, both one-shot events, not
  // a poll loop).
  useStreamEvent('status', (data) => {
    queryClient.setQueryData(queryKeys.status, data);
  });

  return query;
}
```

Not folded into a single `useQuery({queryFn: ...})` with the stream handled as a background
side-effect *inside* that hook's caller (the more "obvious" first instinct) — the query and the
stream subscription are two independent lifecycles (`useQuery` for the one-shot bootstrap +
TanStack's own retry semantics, `useStreamEvent` for the ongoing live feed), and expressing them as
two separate hook calls composed here says exactly that. A `select` transform isn't needed either:
`select` exists to reshape a query's *own* fetched data, not to merge in updates from an unrelated
source.

### `app/(tabs)/index.tsx` + `src/features/status/StatusScreen.tsx`

Replaces the current `<Empty title="Status" message="Fase 1 — todavía sin conexión al gateway." />`
placeholder. Layout, top to bottom:

- **Up/down header**: `service` + `health` as one glanceable line — a colored dot (`accent-cyan` for
  `active`+healthy, `danger` for anything else) and text (`"En línea"` / `"Inactiva"` / `"Falló"`,
  mapped from `service`, with `health === false` while `service === 'active'` rendering `"En línea
  (unhealthy)"` — the gateway distinguishes "the process is up" from "the process is healthy" and
  collapsing that distinction would hide exactly the case an operator most needs to see).
- **`pending_shutdown` banner**, shown only when non-null: reuses the `bg-danger dark:bg-night-danger`
  pill styling `StreamStatusBanner` already established (OC-17), text `"Apagando en {seconds_left}s —
  {reason}"`, `seconds_left` ticking down live via the same `status` stream event (no client-side
  `setInterval` — the mock re-broadcasts every second during a drain, so the displayed number is
  always what the gateway just said, not a locally-extrapolated guess that could drift).
- **Stat rows** (a small local `StatRow` component, `label` + `value`, not promoted to `src/ui/` —
  nothing else needs it yet, matches this repo's own "add primitives when a second screen needs them"
  precedent): `uptime_secs` formatted as `"Xh Ym"` (or `"Xm"` under an hour), `version` verbatim,
  `players_online` as a plain count, `tick_time_ms` as `"X ms"` or `"—"` when `null` (the schema
  allows `null` — a stopped/starting server has no tick timer), `entity_count` and `chunk_count` as
  plain counts, `started_at` formatted as a localized date-time or `"—"` when `null`.
- **Loading state**: while `query.isPending` (no data yet, from any source — neither the bootstrap
  fetch nor a stream push has landed) and `query.error` is null, render `<Empty title="Status"
  message="Cargando…" />`, matching the existing placeholder's shape so the transition isn't jarring.
- **Error state**: `query.error` renders `<Empty title="Status" message={query.error.message} />`
  (verbatim `ApiError.message`, per this app's error-rendering convention everywhere else) — but only
  when there's genuinely no data to show yet (`query.data === undefined`); once *any* data has landed
  (from the bootstrap or a stream push), a later bootstrap-retry failure doesn't blank the screen —
  stale-but-present data beats no data, matching this screen's whole reason for existing.

No pull-to-refresh: unlike OC-19 (players), which explicitly asks for one, this screen is
continuously live via the stream — a manual refresh button would just be a slower path to data the
screen already has.

## Testing

No test runner in this repo. `useStatusQuery` and the screen both need the Expo runtime (React
Query's own hooks, `useStreamEvent`) — verified via `npx tsc --noEmit` plus a live web build
(`npx expo start --web`) against `npm run mock-gateway`: confirm the bootstrap fetch renders real
data before any stream event could plausibly have arrived (a fast network makes this hard to
eyeball directly — instead confirm via the Network tab that exactly one `GET /api/v1/status` request
fires, not a repeating one), confirm the displayed numbers update live when the mock's periodic 5 s
`status` broadcast lands without any new REST request appearing in the Network tab, and drive the
mock's `draining` scenario to confirm the `pending_shutdown` banner appears with a live-ticking
countdown and disappears once the drain completes.

## Out of scope (deliberately)

- `lifecycle`-driven UI — OC-25 (Phase 2), once write actions (start/stop/restart) exist to make a
  state-machine view meaningful; OC-18 is read-only.
- Players/logs/chat/audit screens — OC-19–21, OC-28. This spec's foundation section (`queryClient.ts`,
  `QueryProvider.tsx`, `ApiContext.tsx`) is built for them, not by them.
- Query cache persistence across app restarts (e.g. `@tanstack/query-async-storage-persister`) — this
  app's data is either session-scoped (cleared on logout/environment-switch already) or genuinely
  live (stale the moment the app was last open), so persisting it across a cold start has no clear
  value here; revisit only if a specific screen's UX calls for showing last-known data before the
  first fetch resolves.

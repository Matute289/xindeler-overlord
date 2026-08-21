# Lock-screen Live Activity scaffold (OC-47) design

## Scope: coding-agent-scaffoldable portion only

Per Matías's explicit direction (chat): implement only what a coding agent can build and verify
without his own manual Apple Developer Portal / EAS credential / physical-device steps. This
covers: a working Live Activity that starts, updates, and ends **locally** (from the running app,
no push), buildable and screenshot-verifiable in the iOS Simulator. Explicitly **not** in this
ticket: remote (push-driven) updates via APNs — that needs an ActivityKit-scoped APNs key
configured in the Apple Developer Portal and uploaded to EAS, the same category of gap OC-45's
push notifications already left open (no APNs credentials of any kind exist in EAS today) — and
physical-device validation, which this session's tooling cannot do.

## What was investigated before designing

Two candidate libraries for Live Activities in Expo-managed (CNG) React Native:

- **`expo-live-activity`** (Software Mansion) — **dead**: deprecated on npm, GitHub repo archived
  2026-06-01, its own README now redirects to `expo-widgets`. Not usable for new work.
- **`expo-widgets`** — first-party Expo package, shipped alpha in SDK 55, **promoted to stable in
  SDK 56**, versioned lockstep with the Expo SDK (`57.0.11` matches this app's `~57.0.11` exactly).
  Widgets and Live Activities are defined as React components built from `@expo/ui`'s SwiftUI-
  mapped primitives — no hand-written Swift UI code, no manual Xcode target, no manual App Group
  setup (its own config plugin handles all of that during `expo prebuild`/CNG).

**Chosen: `expo-widgets`.** It requires `@expo/ui` (`~57.0.12`) — already a dependency in this
app (`~57.0.9`, currently installed but unused), so this ticket both activates an existing
dependency and needs a small version bump to satisfy the new requirement. Known risk, explicitly
budgeted for: two "blank widget" bugs were filed against the SDK 55 alpha
(`expo/expo#43646`, `#44123`) — likely resolved by the SDK 56 stable promotion, but not something
to assume from docs alone. The plan's first step is a minimal smoke test (scaffold the emptiest
possible Live Activity, build, start it, screenshot the Simulator) before investing in the real
status/countdown UI, so a still-lurking rendering bug is caught early and cheaply, not after the
full feature is built on top of it.

## Content (Matías's choice, chat): status + players + drain countdown

Sourced from the same data `StatusScreen.tsx`/`useStatusQuery.ts`/`useLifecycleState` already
derive — no new gateway call, no new schema. The Live Activity's content state:

```ts
type ServerStatusActivityState = {
  lifecycleState: 'running' | 'draining' | 'stopped' | 'starting'; // from useLifecycleState
  playersOnline: number;                                            // status.players_online
  drainSecondsLeft: number | null; // status.pending_shutdown?.seconds_left ?? null
};
```

## When it starts/ends (design choice, proposed — flag if you want something different)

A Live Activity is meant to be temporary/event-scoped (Apple's own guidance — not an always-on
background presence), and this app has no existing "ambient, always-on" UI concept to hang an
auto-start off of cleanly. Proposed: a manual toggle, not automatic. A small "Live Activity"
switch on `StatusScreen.tsx` — "Seguir en pantalla de bloqueo" — starts it; tapping again, or
`AuthContext.logout()`, ends it. While active, it updates on every `useStatusQuery`/SSE-driven
status change (same reactive pattern already used everywhere in this app — no polling, no new
timer). iOS's own system-imposed Live Activity lifetime cap (historically ~8-12h) ends it
automatically if the operator never does, which is acceptable and expected behavior, not a bug to
work around.

## Architecture

**New dependencies**: `expo-widgets` (`~57.0.11`), bump `@expo/ui` to `~57.0.12`.

**`app.config.ts`**: add `expo-widgets`' config plugin to the existing `plugins` array (options:
`groupIdentifier` left at its default, `group.<bundle id>` — no remote images in this content, so
no reason to deviate from the library's own default).

**`src/features/status/ServerStatusActivity.tsx`** (new): the Live Activity's React component
definition, built from `@expo/ui/swift-ui` primitives (`Text`/`VStack`/`HStack` — exact primitive
choice deferred to implementation, matching whatever `expo-widgets`' actual current API surface
supports; the plan must re-confirm the exact import paths/component names against the installed
package version rather than trusting this design doc's own paraphrase of pre-installation
research). Renders `lifecycleState` (as Spanish text: "Activo"/"Drenando"/"Detenido"/"Iniciando"),
`playersOnline`, and — only when `drainSecondsLeft !== null` — a countdown. `createLiveActivity`
call lives in this same file, exported for the hook below to use.

**`src/features/status/useServerStatusLiveActivity.ts`** (new): a hook — not a screen — owning
the toggle state, the `start()`/`update()`/`end()` lifecycle, and the reactive wiring to
`useStatusQuery()`. Returns `{ active: boolean; toggle: () => void }` for `StatusScreen.tsx` to
render a switch against. `useEffect` watching the query's derived `ServerStatusActivityState`:
while `active`, every change calls `.update()` on the current instance (no-op comparison first,
to avoid a redundant native call on an unrelated re-render).

**`src/features/status/StatusScreen.tsx`** (modified): one new switch row, matching this
screen's existing layout conventions, wired to the new hook.

## Out of scope, explicitly

- Push-driven remote updates (APNs credentials don't exist in EAS yet — `OC-45`'s own open gap).
- Auto-starting the Live Activity without operator action.
- Android (Live Activities are iOS-only; this ticket does not touch Android at all).
- Any change to `useStatusQuery`/`useLifecycleState`/the `/status` schema — pure consumption.

## Testing

No test runner. `npx tsc --noEmit` / `npm run lint` / `npm run format:check` for the
TypeScript/config side (this doesn't touch or validate Swift — there is none, `expo-widgets`
generates the native layer). The real verification is native: `npx expo prebuild -p ios --clean`
succeeds, `npx expo run:ios` builds and launches on Simulator, toggling the switch starts a Live
Activity, and `xcrun simctl io booted screenshot` captures the Dynamic Island showing real content
(the lock-screen banner specifically needs the simulator in a locked state, which isn't cleanly
scriptable via public `simctl` commands — treat that specific surface as a manual/GUI follow-up
Matías can check himself, name it as such rather than silently skipping it). This is native-build
verification, the same category `OC-46`/`OC-58` already established as this session's own
precedent for iOS-only work — build/install/launch succeeding plus a Dynamic Island screenshot are
real, checkable signals; end-to-end lock-screen confirmation stays honestly unverified by this
session, same as those tickets' own native gaps.

# Lock-Screen Live Activity Scaffold (OC-47) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working, locally-started/updated/ended iOS Live Activity showing server status,
players online, and drain countdown — the coding-agent-scaffoldable slice of `OC-47`, verified by
a real Simulator build, not just TypeScript compiling.

**Architecture:** `expo-widgets` (first-party Expo package, stable as of SDK 56, matching this
app's SDK 57) — Live Activities are defined as React components over `@expo/ui`'s SwiftUI-mapped
primitives, no hand-written Swift. Two tasks: first a minimal smoke test to catch any rendering
issue early and cheap (this library was alpha as recently as SDK 55, with two now-likely-fixed
"blank widget" bugs on record), then the real status/countdown content plus a toggle on
`StatusScreen.tsx`.

**Tech Stack:** TypeScript, React Native (Expo, `@expo/ui`), `expo-widgets`, iOS ActivityKit (via
the library — no Swift written by hand in this plan).

## Global Constraints

- No test runner exists in this repo — verification is `npx tsc --noEmit` / `npm run lint` /
  `npm run format:check` for the TS/config side, plus REAL native verification: `expo prebuild`,
  `npx expo run:ios`, and `xcrun simctl io booted screenshot` — this is iOS-only, native-build
  work, not something browser automation or the mock gateway can verify.
- **This plan's code snippets for `expo-widgets`' own API (`createLiveActivity`, the
  `@expo/ui/swift-ui` primitive names/imports, `.start()`/`.update()`/`.end()` signatures) are
  based on pre-installation research and may not exactly match the real, currently-published
  package.** Task 1's first step is installing the real package and reading its actual type
  definitions/README/example directly from `node_modules` before writing any widget code against
  it — treat this plan's own code as a best-effort sketch to correct against ground truth, not
  verbatim truth the way every other file in this plan's sibling tickets has been. If the real API
  differs from what's sketched here, use the real one and note the discrepancy in your report.
- Local-only Live Activity (start/update/end from the running app) — no push/APNs work, no
  Apple Developer Portal changes, no EAS credential changes. If implementing this reveals that ANY
  step requires Matías's own manual portal/credential/signing action beyond what's already
  scaffolded by `expo-widgets`' own config plugin, STOP and report it rather than attempting to
  work around it — that boundary is the whole reason this ticket is scoped the way it is.
- No Android work — Live Activities are iOS-only.
- No change to `useStatusQuery`/`useLifecycleState`/the `/status` schema.

---

## Task 1: Install `expo-widgets`, confirm its real API, minimal smoke test

**Files:**
- Modify: `package.json` (add `expo-widgets`, bump `@expo/ui`)
- Modify: `app.config.ts` (add `expo-widgets`' config plugin)
- Create: `src/features/status/ServerStatusActivity.tsx` (minimal version — a single static text
  string, no real data yet, just proving the pipeline renders something)
- Create: a small temporary trigger to call `.start()` once (exact mechanism your choice — e.g. a
  button on `StatusScreen.tsx` you can remove/replace in Task 2, or a one-off call in `App`'s
  mount effect gated behind `__DEV__` — whichever is simplest to smoke-test with, since Task 2
  replaces this file's content and the trigger wiring anyway)

**Interfaces:**
- Produces: confirmation (in your report) of `expo-widgets`' REAL, currently-installed API surface
  — the actual import paths, the actual `createLiveActivity`/widget-definition function signature,
  the actual instance methods for start/update/end, and the actual `@expo/ui/swift-ui` (or
  wherever they actually live) primitive component names available for building the widget's
  layout. Task 2's brief will be written from what you report here, not from this plan's own
  pre-installation guesses.

- [ ] **Step 1: Install dependencies**

```bash
npx expo install expo-widgets
npx expo install @expo/ui
```

(`npx expo install` resolves the correct SDK-57-compatible versions automatically — do not pin
exact versions by hand unless `expo install` itself reports a conflict.)

- [ ] **Step 2: Read the real, installed API before writing any widget code**

```bash
cat node_modules/expo-widgets/README.md 2>/dev/null | head -200
find node_modules/expo-widgets -iname "*.d.ts" -exec cat {} \;
find node_modules/expo-widgets -path "*example*" -o -path "*docs*" 2>/dev/null
```

Also check `node_modules/@expo/ui`'s own type definitions for the SwiftUI-primitive component
names actually exported (`Text`, `VStack`, `HStack`, or whatever the real names are — do not
assume without checking).

Record what you find — the real function/type names, the real import paths — you'll need this for
your report and for Step 3 below.

- [ ] **Step 3: Add the config plugin to `app.config.ts`**

Read the current `app.config.ts` first (the plugins array currently has `expo-router`,
`expo-secure-store`, `expo-local-authentication`, `expo-notifications`, `expo-splash-screen`).
Add `expo-widgets` to that array, following whatever configuration shape its own README/type
definitions actually specify (a bare string entry if it needs no options, or a `[name, options]`
tuple if it does — confirmed in Step 2, not assumed).

- [ ] **Step 4: Create a minimal `ServerStatusActivity.tsx`**

The simplest possible Live Activity that proves the pipeline works end-to-end: a single static
`Text` (or whatever the real primitive is called) reading something like `"OC-47 smoke test"` —
no dynamic content state yet, no real status data. Use the REAL API confirmed in Step 2, not this
plan's earlier design-doc sketch.

- [ ] **Step 5: Wire a one-off trigger to start it**

Add whatever minimal trigger you judge simplest (a temporary button, a dev-only mount effect —
your call, this is throwaway/replaceable scaffolding Task 2 will build the real version on top
of) that calls the widget's `.start()` (or equivalent) once, so you can observe it actually
appearing.

- [ ] **Step 6: Type-check, lint, format**

Run: `npx tsc --noEmit` — expect 0 errors.
Run: `npm run lint` — expect 0 errors.
Run: `npm run format:check` — expect clean.

- [ ] **Step 7: Real native build and Simulator verification**

```bash
npx expo prebuild -p ios --clean
```

Expect this to succeed and generate an `ios/` directory including the new widget extension
target (confirm by checking for a new target/directory under `ios/` — its exact name depends on
`expo-widgets`' own naming convention).

```bash
npx expo run:ios
```

Expect a successful build and install to a booted Simulator (pick any available iPhone
simulator — check `xcrun simctl list devices available` if none is already booted). This can take
several minutes; that's normal for a native build with a new extension target.

Once the app is running and you've triggered the smoke-test Live Activity via Step 5's trigger:

```bash
xcrun simctl io booted screenshot /tmp/oc47-smoke-test.png
```

Read the resulting screenshot (via the Read tool, it supports images) and confirm the Live
Activity content is actually visible somewhere (Dynamic Island is the most reliably
screenshot-verifiable surface per this ticket's own design doc — the lock-screen banner
specifically needs the simulator in a locked state, which isn't cleanly scriptable; if you can't
get the lock-screen view, that's expected and fine, just note it, don't spend excessive time
fighting simctl for it).

**If the widget renders blank** (matching the known SDK-55-era bug pattern this plan's design doc
flagged) **or the build fails in a way you can't resolve after a reasonable investigation, STOP
and report BLOCKED** — this is exactly the failure mode the smoke test exists to catch early,
before Task 2 builds real content on top of a broken foundation. Do not spend excessive time
debugging a fundamentally broken library integration; report what you tried and what you observed.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json app.config.ts src/features/status/ServerStatusActivity.tsx
git commit -m "feat(oc47): install expo-widgets, minimal Live Activity smoke test"
```

(Include whatever trigger-wiring file you touched in Step 5 in this commit too — e.g. if you
added a temporary button to `StatusScreen.tsx`, include that file.)

---

## Task 2: Real status/countdown content, StatusScreen toggle

**Files:**
- Modify: `src/features/status/ServerStatusActivity.tsx` (replace the smoke-test content with
  the real status/players/countdown layout)
- Create: `src/features/status/useServerStatusLiveActivity.ts`
- Modify: `src/features/status/StatusScreen.tsx` (replace Task 1's throwaway trigger with the
  real toggle switch)

**Interfaces:**
- Consumes: Task 1's confirmed-real `expo-widgets` API (read Task 1's report for the exact
  names/signatures — do not re-derive from this plan's own earlier sketch, which was written
  before installation).
- Consumes: `useStatusQuery()` (`src/features/status/useStatusQuery.ts`) and `useLifecycleState`
  (wherever Task 1's report or your own reading of `StatusScreen.tsx` confirms it lives) — both
  pre-existing, unchanged by this ticket.
- Produces: `useServerStatusLiveActivity(): { active: boolean; toggle: () => void }` — the hook
  `StatusScreen.tsx` renders its switch against.

- [ ] **Step 1: Read Task 1's report for the confirmed-real `expo-widgets` API**

Before writing any code, read `[the task-1 report file path, provided in your dispatch]` in full
— it names the real function/type names, import paths, and primitive components you must use.

- [ ] **Step 2: Define the real content shape and layout in `ServerStatusActivity.tsx`**

```ts
type ServerStatusActivityState = {
  lifecycleState: 'running' | 'draining' | 'stopped' | 'starting';
  playersOnline: number;
  drainSecondsLeft: number | null;
};
```

Render (using whatever the REAL confirmed primitive components are — this is illustrative
structure, not literal code to copy verbatim):
- A label mapping `lifecycleState` to Spanish text: `running` → "Activo", `draining` →
  "Drenando", `stopped` → "Detenido", `starting` → "Iniciando".
- `playersOnline` as e.g. "N jugadores".
- When `drainSecondsLeft !== null`, a countdown display (exact widget-native countdown mechanism
  — e.g. a native countdown-text primitive if `@expo/ui`/`expo-widgets` exposes one, or a plain
  formatted-seconds string updated on each `.update()` call if not — use whatever's actually
  available, confirmed against the real API, not assumed).

- [ ] **Step 3: Create `src/features/status/useServerStatusLiveActivity.ts`**

Owns:
- `active: boolean` state (whether an activity instance is currently running).
- `toggle()`: if not active, calls the widget's start function with the current
  `ServerStatusActivityState` derived from `useStatusQuery()`'s current data, stores the
  returned instance, sets `active = true`. If active, ends the current instance, sets
  `active = false`.
- A `useEffect` watching `useStatusQuery()`'s data (or whatever reactive value
  `useLifecycleState` exposes): while `active`, on every change, calls the instance's update
  function with the new derived state. Compare against the previously-sent state first (a simple
  shallow/JSON comparison is fine) to avoid a redundant native call when an unrelated re-render
  fires with unchanged status data.
- Ends the activity (if active) on unmount and — check `AuthContext.tsx`'s `logout()` to see if
  there's a clean way to hook into it, e.g. via a small callback registration, or simplest: just
  end it in this hook's own cleanup effect keyed on some auth-status signal from `useAuth()` if
  that's simpler than modifying `AuthContext` itself. Use your judgment; do not modify
  `AuthContext.tsx` itself unless genuinely necessary — prefer keeping this self-contained.

- [ ] **Step 4: Wire the real toggle into `StatusScreen.tsx`**

Read the current file first. Remove whatever throwaway trigger Task 1 added. Add a switch row
(matching whatever switch/toggle UI component this app already uses elsewhere, if any exists —
check `src/ui/` for a `Switch`-like component before inventing new styling; if none exists, a
simple `Pressable`-based toggle matching this screen's existing button/row conventions is fine)
labeled "Seguir en pantalla de bloqueo", wired to `useServerStatusLiveActivity()`'s `active`/
`toggle`.

- [ ] **Step 5: Type-check, lint, format**

Run: `npx tsc --noEmit` — expect 0 errors.
Run: `npm run lint` — expect 0 errors.
Run: `npm run format:check` — expect clean.

- [ ] **Step 6: Real native build and Simulator verification**

```bash
npx expo run:ios
```

(No need to re-run `expo prebuild --clean` unless the config plugin options changed — a normal
rebuild picks up the new TS/Swift-generated content.)

Once running: toggle the switch on, trigger a status change if practical (e.g. against
`npm run mock-gateway`'s own scenario-switching, if that's already running — check
`tools/mock-gateway`'s README/`docs reference` for how to simulate a draining scenario), and
screenshot the Simulator (`xcrun simctl io booted screenshot`) to confirm the Live Activity shows
real status/player-count/countdown content, not just the Task 1 placeholder text. Toggle off and
confirm (via a second screenshot, or by confirming no crash/error) that ending the activity works
cleanly.

- [ ] **Step 7: Commit**

```bash
git add src/features/status/ServerStatusActivity.tsx src/features/status/useServerStatusLiveActivity.ts src/features/status/StatusScreen.tsx
git commit -m "feat(oc47): real server-status Live Activity content and toggle"
```

---

## Final live verification (after both tasks land)

- [ ] Full flow: log in, navigate to Status, toggle the Live Activity on, confirm real content
      appears (screenshot), trigger a status change against the mock and confirm the Live
      Activity content updates to match, toggle off, confirm it ends cleanly.
- [ ] Confirm `npx tsc --noEmit` / `npm run lint` / `npm run format:check` all still pass on the
      full branch.
- [ ] Explicitly document in the final report (for the backlog row) exactly what remains
      Matías's own manual work: Apple Developer Portal ActivityKit-push APNs key generation,
      uploading it to EAS, and physical-device end-to-end validation (including the lock-screen
      banner surface specifically, which this plan's own Simulator verification couldn't cleanly
      automate).

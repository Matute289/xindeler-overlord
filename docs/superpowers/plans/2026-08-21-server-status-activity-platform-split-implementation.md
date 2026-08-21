# ServerStatusActivity Platform Split — Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a currently-broken Web build (and probably Android) caused by
`src/features/status/ServerStatusActivity.tsx`'s module-scope import of `@expo/ui/swift-ui`,
which throws unconditionally outside iOS, by splitting the file along React Native's standard
platform-extension convention — with zero regression to the already-shipped, already-verified
iOS Live Activity feature (OC-47).

**Architecture:** Extract the shared `ServerStatusActivityState` type to its own dependency-free
file. Rename the current file to `ServerStatusActivity.ios.tsx` (byte-identical content except
the type import). Add a new extensionless `ServerStatusActivity.ts` that Metro resolves for
every platform without a more specific match (Android, Web) — it calls the same
`createLiveActivity` with a trivial `layout` that returns `null` for every field and never
imports `@expo/ui/swift-ui`, relying on `expo-widgets`'s own already-safe platform stub
(`LiveActivityFactoryStub`) to make the whole thing a real no-op outside iOS. The one consumer,
`useServerStatusLiveActivity.ts`, is untouched.

**Tech Stack:** Expo Router / Metro bundler platform-extension resolution (`.ios.tsx` > bare
`.ts`/`.tsx`), `expo-widgets`, TypeScript.

## Global Constraints

- Zero changes to `useServerStatusLiveActivity.ts` or any other consumer — the whole point of the
  platform-extension split is that consumers stay untouched.
- `ServerStatusActivity.ios.tsx`'s content must be byte-identical to the current
  `ServerStatusActivity.tsx` except for the one import swap described in Task 1 — this is a
  shipped, already-live-verified iOS feature (OC-47); do not "clean up" or restructure anything
  else in this file while moving it.
- No test runner in this repo. Verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run format:check` (all must stay clean).
- **Mandatory real manual verification, not just static reasoning** — see Task 1, Step 8. This is
  the important part of this fix, given the regression risk to an already-shipped iOS feature.
- Design doc: `docs/specs/2026-08-21-server-status-activity-platform-split-design.md`.

---

## Task 1: Split `ServerStatusActivity` by platform and verify both Web and iOS live

**Files:**
- Create: `src/features/status/ServerStatusActivityState.ts`
- Create: `src/features/status/ServerStatusActivity.ios.tsx`
- Create: `src/features/status/ServerStatusActivity.ts`
- Delete: `src/features/status/ServerStatusActivity.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the only task).
- Produces: `ServerStatusActivityState` (type, from `ServerStatusActivityState.ts`),
  `serverStatusActivity` (value, exported identically — same name, same type — from both
  `ServerStatusActivity.ios.tsx` and `ServerStatusActivity.ts`). `useServerStatusLiveActivity.ts`
  already imports both of these from `./ServerStatusActivity` (extensionless) — this task must
  not change that file, and Metro's platform resolution handles routing to the correct one of the
  two new files per platform automatically.

- [ ] **Step 1: Create the shared type file**

Create `src/features/status/ServerStatusActivityState.ts`:

```ts
// Kept in sync with `useServerStatusLiveActivity.ts`'s own copy of this shape (that file cannot
// import this type directly — see the comment there for why) and loosely mirrors
// `useLifecycleState.ts`'s `LifecycleState` union plus the two fields off `Status`
// (`players_online`, `pending_shutdown.seconds_left`) this activity actually needs. Deliberately
// NOT the full `Status` object — only what's rendered here, kept small since every field crosses
// into the widget extension's own process on every `.start()`/`.update()` call.
//
// Extracted to its own file (not defined inside `ServerStatusActivity.ios.tsx`) so both the real
// iOS implementation and the Android/Web stub can import the identical type without duplicating
// it — see `docs/specs/2026-08-21-server-status-activity-platform-split-design.md`.
export type ServerStatusActivityState = {
  lifecycleState: 'running' | 'draining' | 'stopped' | 'starting';
  playersOnline: number;
  drainSecondsLeft: number | null;
};
```

- [ ] **Step 2: Create the iOS implementation file**

Create `src/features/status/ServerStatusActivity.ios.tsx` with this exact content (this is the
current `ServerStatusActivity.tsx` verbatim, with only the type definition replaced by an import
from the new shared file):

```tsx
import type { ServerStatusActivityState } from './ServerStatusActivityState';
import { Text, VStack } from '@expo/ui/swift-ui';
import { createLiveActivity, type LiveActivityComponent } from 'expo-widgets';

// The `'widget'` directive (first statement in the function body, exactly like `'use client'`) is
// what babel-preset-expo's widgets-plugin looks for (see
// node_modules/babel-preset-expo/build/plugins/widgets-plugin.js) — it stringifies this exact
// function body (via @babel/generator, verbatim AST -> source, no scope-checking) at build time
// so it can be evaluated natively inside the widget extension's own embedded JavaScriptCore
// runtime. Two consequences confirmed in Task 1's report, both load-bearing for how this function
// is written:
//   1. It must stay a block-bodied function (not an implicit-return arrow) for the directive to
//      parse — `!t.isBlockStatement(path.node.body)` bails the plugin out otherwise.
//   2. Nothing outside this function's own parameters is available at runtime — the surrounding
//      module scope is stripped. `Text`/`VStack` resolve as globals supplied by expo-widgets' own
//      pre-bundled `ExpoWidgets.bundle` (a real `@expo/ui/swift-ui`, not this file's import), but
//      any helper function or constant defined elsewhere in this file (e.g. a
//      `lifecycleLabel(state)` map reused from `StatusScreen.tsx`) would NOT be — so the Spanish
//      label mapping and countdown-window math are inlined directly in the function body below
//      rather than factored out, even though that duplicates `StatusScreen.tsx`'s own
//      `lifecycleLabel`.
const layout: LiveActivityComponent<ServerStatusActivityState> = (props) => {
  'widget';
  const stateLabel =
    props.lifecycleState === 'running'
      ? 'Activo'
      : props.lifecycleState === 'draining'
        ? 'Drenando'
        : props.lifecycleState === 'stopped'
          ? 'Detenido'
          : 'Iniciando';
  const playersLabel = `${props.playersOnline} jugadores`;
  // Real widget-native countdown primitive (@expo/ui/swift-ui's `Text` maps straight to
  // SwiftUI's `Text(timerInterval:countsDown:)`, confirmed present in
  // node_modules/@expo/ui/build/swift-ui/Text/index.d.ts) — once rendered, this ticks down on
  // its own via the system clock inside the widget extension process; it does NOT need a JS
  // timer or a `.update()` call every second. `lower` is "now" as of this render (i.e. as of
  // the most recent `.start()`/`.update()` call that produced this exact `drainSecondsLeft`),
  // `upper` is that instant plus the seconds remaining reported by the gateway.
  const countdown =
    props.drainSecondsLeft !== null ? (
      <Text
        timerInterval={{
          lower: new Date(),
          upper: new Date(Date.now() + props.drainSecondsLeft * 1000),
        }}
        countsDown
      />
    ) : null;

  return {
    banner: (
      <VStack alignment="leading" spacing={4}>
        <Text>{stateLabel}</Text>
        <Text>{playersLabel}</Text>
        {countdown}
      </VStack>
    ),
    compactLeading: <Text>{stateLabel}</Text>,
    compactTrailing: countdown ?? <Text>{playersLabel}</Text>,
    minimal: <Text>{String(props.playersOnline)}</Text>,
  };
};

// `createLiveActivity`'s real signature (confirmed from node_modules/expo-widgets/build/Widgets.d.ts):
//   createLiveActivity<T extends object>(name: string, liveActivity: LiveActivityComponent<T>): LiveActivityFactory<T>
// Unlike home-screen widgets, this `name` does NOT need to match any entry in app.config.ts's
// `expo-widgets` plugin `widgets` array — Live Activities are handled generically by the native
// module regardless of that config (confirmed by reading
// node_modules/expo-widgets/plugin/build/ios/withWidgetSourceFiles.js).
export const serverStatusActivity = createLiveActivity<ServerStatusActivityState>(
  'ServerStatusActivity',
  layout,
);
```

- [ ] **Step 3: Create the Android/Web stub file**

Create `src/features/status/ServerStatusActivity.ts` (no platform suffix — Metro serves this to
Android and Web, since neither has a more specific `.android.ts`/`.web.ts` match and both fall
through past `.ios.tsx`):

```ts
import { createLiveActivity, type LiveActivityComponent } from 'expo-widgets';

import type { ServerStatusActivityState } from './ServerStatusActivityState';

// Android/Web stub. `@expo/ui/swift-ui` (used by the real iOS implementation in
// `ServerStatusActivity.ios.tsx`) throws unconditionally outside iOS — its `Text` component
// calls `requireNativeView` at module load time, before any `Platform.OS` check can help. This
// file intentionally has NO such import. `expo-widgets`' own `createLiveActivity` is already
// platform-safe (it has its own `ExpoWidgets.ios.js`/generic-fallback split, confirmed in
// `node_modules/expo-widgets/build/ExpoWidgets.js` — the fallback `LiveActivityFactoryStub`
// ignores the `layout` argument entirely), so `layout` below never actually runs outside iOS; it
// exists only to satisfy `createLiveActivity`'s type signature. See
// `docs/specs/2026-08-21-server-status-activity-platform-split-design.md`.
const layout: LiveActivityComponent<ServerStatusActivityState> = () => ({
  banner: null,
  compactLeading: null,
  compactTrailing: null,
  minimal: null,
});

export const serverStatusActivity = createLiveActivity<ServerStatusActivityState>(
  'ServerStatusActivity',
  layout,
);
```

- [ ] **Step 4: Delete the original file**

```bash
git rm src/features/status/ServerStatusActivity.tsx
```

An extensionless `.tsx` left alongside the new bare `.ts` fallback would conflict with Metro's
resolution for it — it must not remain.

- [ ] **Step 5: Confirm `useServerStatusLiveActivity.ts` is untouched**

Run: `git diff --stat src/features/status/useServerStatusLiveActivity.ts`
Expected: no output (zero changes) — this file must not appear in your diff at all.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: 0 errors (the repo-wide pre-existing `import/no-duplicates` resolver warnings are
unrelated and expected to still appear at their existing count; no new warnings from the four
files this task touches).

Run: `npm run format:check`
Expected: clean (run `npm run format` first if it reports issues in files you touched).

- [ ] **Step 7: Commit**

```bash
git add src/features/status/ServerStatusActivityState.ts \
  src/features/status/ServerStatusActivity.ios.tsx \
  src/features/status/ServerStatusActivity.ts
git commit -m "fix: split ServerStatusActivity by platform, unblocking Web/Android (was crashing on the module-scope @expo/ui/swift-ui import)"
```

(`git rm` from Step 4 stages the deletion; it's included in this commit automatically alongside
the `git add` above since both touch the same commit.)

- [ ] **Step 8: Mandatory manual verification — Web fix and iOS regression check**

This step is required, not optional. Do not report this task done without completing both (1)
and (2) below; (3) is best-effort.

**(1) Web — confirm the fix:**

Run `npx expo start --web` (start the mock gateway too if needed — `npm run mock-gateway`, per
this repo's `ops-run` skill conventions), open the app in a real browser, and load `/` (Status
tab). Confirm it renders without the `requireNativeViewManager is not available on web` crash
that previously took down the whole app on this route. If browser automation tooling
(`claude-in-chrome`) is available to you, use it and take a screenshot as evidence; otherwise
describe exactly what you observed (page content, any console errors via whatever means you have)
in your report.

**(2) iOS — confirm no regression on the already-shipped Live Activity feature:**

Run `npx expo prebuild -p ios --clean`, then `npx expo run:ios` (this machine has Xcode 26.6 +
iOS 26.5 Simulator pre-configured — see `docs/specs/2026-08-20-lock-screen-widget-scaffold-design.md`
for the OC-47 precedent this is re-verifying). Once the app is running in Simulator:
- Log in (mock credentials: `matias` / `mock`, TOTP `000000`).
- On the Status tab, toggle the Live Activity on. Confirm it appears (Lock Screen or Dynamic
  Island / notification center on Simulator, whichever is visible) showing the current
  lifecycle state and player count — the same content OC-47's own verification pass already
  confirmed, now just re-confirming the file split didn't break it.
- Toggle it off. Confirm it ends cleanly (disappears, no crash, no leftover activity).
- Take a Simulator screenshot (`xcrun simctl io booted screenshot <path>`) at least once showing
  the Live Activity content as evidence.

**(3) Android — best-effort:**

If an Android emulator/AVD is readily available per this repo's `ops-run` skill conventions
(`xindeler-ops-test` AVD), run `npx expo run:android` and confirm the app boots and the Status
tab renders without crashing. This is not required to complete the task — if the emulator isn't
readily available or this takes materially longer than the Web/iOS checks, note in your report
that it was skipped and why, rather than blocking on it.

Record the outcome of all three checks in your report — this is the acceptance evidence for the
whole fix, not just Step 6's type-check/lint.

# Tablet Full-Screen Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the app rendering letterboxed/phone-sized on iPad, and make the wide-breakpoint
layout use the available screen space well (capped, not edge-to-edge) — verified live on iPad and
best-effort on an Android tablet emulator.

**Architecture:** One iOS config fix (`supportsTablet`) removes the OS-level letterboxing; one
shared-component change (`Screen.tsx`) caps and centers content width only at the existing `'wide'`
breakpoint; then a visual review pass fixes anything that still looks broken/wasteful once the app
actually renders at full iPad width.

**Tech Stack:** Expo SDK 57, React Native 0.86, NativeWind/Tailwind CSS 3, Expo Router. No new
dependencies.

## Global Constraints

- `useBreakpoint() === 'phone'` behavior must never change in any task — every diff must leave the
  phone code path provably identical to today (an early-return / ternary branch that renders
  exactly what renders today, not a modified version of it).
- `ios.supportsTablet` is iOS-only — must not touch `android` or `web` config in `app.config.ts`.
- The max-width cap lives in exactly one file, `src/ui/Screen.tsx` — no per-screen width changes
  anywhere else, in any task.
- No multi-column, master-detail, or per-content-type tablet redesign in any task — this plan is a
  full-width-usage fix, not a tablet-specific feature.
- No test runner exists in this repo — verification is `npx tsc --noEmit` / `npm run lint` /
  `npm run format:check` plus real manual verification against the running app (mock gateway,
  `npm run mock-gateway`), same convention as every other plan in this repo.
- Android tablet verification is explicitly best-effort — if AVD creation or the emulator turns out
  impractical, fall back to the static config check already done in the design doc (no manifest
  restriction found) and move on; this must never block the plan.

---

### Task 1: iOS — enable `supportsTablet` and verify the letterboxing is gone

**Files:**
- Modify: `app.config.ts` (the `ios` block)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing later tasks import — this is a native capability flag, verified purely by
  running the app, not by any code contract.

- [ ] **Step 1: Add `supportsTablet: true` to the `ios` config block**

In `app.config.ts`, change:

```ts
  ios: {
    bundleIdentifier: 'com.xindeler.overlord',
    config: {
      usesNonExemptEncryption: false,
    },
  },
```

to:

```ts
  ios: {
    bundleIdentifier: 'com.xindeler.overlord',
    supportsTablet: true,
    config: {
      usesNonExemptEncryption: false,
    },
  },
```

- [ ] **Step 2: Regenerate the native iOS project**

Run: `npx expo prebuild -p ios --clean`

Expected: completes without error; `ios/Overlord/Info.plist` now contains
`UIDeviceFamily` with both `1` (iPhone) and `2` (iPad) — confirm with:
`grep -A5 UIDeviceFamily ios/Overlord/Info.plist`. Before this change it only listed `1`.

- [ ] **Step 3: Build and boot on an iPad Simulator**

```bash
xcrun simctl boot "iPad Pro 13-inch (M5)" 2>&1 || true   # `|| true`: no-op if already booted
open -a Simulator
npx expo run:ios --device "iPad Pro 13-inch (M5)"
```

Wait for `iOS Bundled` in the Metro output before proceeding — same startup sequence used
throughout this repo's own native-verification work (see `.claude/skills/ops-run/SKILL.md` §7 for
the general iOS-Simulator-automation approach this task reuses in Step 4).

- [ ] **Step 4: Confirm no letterboxing, portrait and landscape**

Take a screenshot in the default orientation:

```bash
xcrun simctl io booted screenshot /tmp/ipad-portrait-before-fix2.png
```

Expected: the app fills the entire iPad screen edge to edge (background color, `EnvironmentBadge`,
etc. all the way to the physical screen edges) — no black bars, no small centered phone-sized
rectangle. Rotate to landscape (`xcrun simctl` has no direct rotate command; use the Simulator
app's own `Hardware > Rotate` shortcut via `osascript` is unreliable per this repo's own documented
Accessibility-permission limitation — instead, boot a landscape-shaped check isn't required for
Task 1 specifically, since `supportsTablet` is an OS-level window-sizing flag independent of app
orientation; confirming portrait fills the screen is sufficient evidence Task 1's fix works.
Landscape gets its own visual confirmation in Task 3, once Fix 2's content layout is also in place).

This screenshot is throwaway evidence for this task, not a deliverable — no need to keep the file.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add app.config.ts ios/
git commit -m "fix(tablet): enable ios.supportsTablet so iPad stops rendering letterboxed"
```

`ios/` changes: only the regenerated `Info.plist` (and possibly `project.pbxproj` metadata) should
differ — if `prebuild` regenerated anything else unexpected (e.g. unrelated file churn), diff it
before committing and flag it in the task report rather than committing blindly.

---

### Task 2: shared max-width cap in `Screen.tsx`, phone and web unaffected

**Files:**
- Modify: `src/ui/Screen.tsx`

**Interfaces:**
- Consumes: `useBreakpoint()` from `src/ui/useBreakpoint.ts` (already exists, exports
  `'phone' | 'wide'`, unmodified by this task).
- Produces: `Screen`'s existing exported signature (`{ children: ReactNode }`) is unchanged — every
  route that already does `<Screen><FeatureScreen /></Screen>` needs zero changes to pick this up:
  the 13 routes under `app/(tabs)/*.tsx` plus the 3 `(auth)` routes (`login.tsx`, `totp.tsx`,
  `environment.tsx`) — 16 routes total.

- [ ] **Step 1: Add the wide-breakpoint max-width wrapper**

Current `src/ui/Screen.tsx`:

```tsx
// src/ui/Screen.tsx
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({ children }: { children: ReactNode }) {
  return (
    // `top` excluded: every current screen renders under EnvironmentBadge
    // (app/(tabs)/_layout.tsx), which already accounts for the top inset -
    // applying it again here would double-pad. Revisit if Screen is ever
    // used outside that nav shell (e.g. a future full-bleed login screen).
    <SafeAreaView
      edges={['bottom', 'left', 'right']}
      className="flex-1 bg-bg-base dark:bg-night-bg-base"
    >
      <View className="flex-1 bg-bg-base dark:bg-night-bg-base">{children}</View>
    </SafeAreaView>
  );
}
```

Replace with:

```tsx
// src/ui/Screen.tsx
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBreakpoint } from '@/ui/useBreakpoint';

// A starting point, not a final number — tuned by eye against a real iPad Simulator in this
// plan's own verification task (docs/specs/2026-08-27-tablet-full-screen-design.md). Only ever
// applied at the 'wide' breakpoint; the 'phone' path below never references this.
const WIDE_CONTENT_MAX_WIDTH = 960;

export function Screen({ children }: { children: ReactNode }) {
  const breakpoint = useBreakpoint();

  return (
    // `top` excluded: every current screen renders under EnvironmentBadge
    // (app/(tabs)/_layout.tsx), which already accounts for the top inset -
    // applying it again here would double-pad. Revisit if Screen is ever
    // used outside that nav shell (e.g. a future full-bleed login screen).
    <SafeAreaView
      edges={['bottom', 'left', 'right']}
      className="flex-1 bg-bg-base dark:bg-night-bg-base"
    >
      <View className="flex-1 bg-bg-base dark:bg-night-bg-base">
        {breakpoint === 'wide' ? (
          <View className="mx-auto w-full flex-1" style={{ maxWidth: WIDE_CONTENT_MAX_WIDTH }}>
            {children}
          </View>
        ) : (
          children
        )}
      </View>
    </SafeAreaView>
  );
}
```

`style={{ maxWidth: ... }}` rather than a NativeWind `max-w-[960px]` class: this file already mixes
inline `style` and `className` nowhere else, but a numeric constant used in exactly one place reads
more clearly as a plain style than as a dynamically-interpolated arbitrary-value class string, and
avoids NativeWind having to parse a template-interpolated class name (which its static analysis can
struggle with). `mx-auto`/`w-full`/`flex-1` stay as `className` since none of those are dynamic.

The `'phone'` branch renders `children` completely unwrapped — provably identical to what this
function returned before this change for every phone-width caller.

- [ ] **Step 2: Typecheck, lint, format**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: all three clean (same pre-existing warning count as before this change, if any).

- [ ] **Step 3: Verify phone is unaffected (web, fastest iteration loop)**

```bash
npm run mock-gateway &
npx expo start --web
```

Log in (`matias` / `mock` / `000000` per this repo's standard mock credentials), resize the browser
window to under 768px wide, and confirm the Status screen renders exactly as before this task (tab
bar at the bottom is irrelevant here since web always uses whichever `useBreakpoint()` returns —
the check is purely "does content still fill the narrow width with no unexpected side gaps").

- [ ] **Step 4: Verify web at a wide window**

Resize the same browser window to 1400px+ wide. Expected: content now visibly centers with a
comfortable margin on both sides once past 960px total width, `SidebarLayout` (not `<Tabs>`) is
active, and the sidebar plus centered content together look reasonable — this is the first live
look at the cap in action, on the fastest platform to iterate on. If `960` obviously looks wrong
here (e.g. absurdly narrow or barely different from edge-to-edge), adjust `WIDE_CONTENT_MAX_WIDTH`
now rather than waiting for Task 3's iPad-specific pass — Task 3 is for screen-by-screen content
issues, not for finding the right ballpark number.

- [ ] **Step 5: Commit**

```bash
git add src/ui/Screen.tsx
git commit -m "feat(tablet): cap and center screen content at the wide breakpoint"
```

---

### Task 3: iPad visual review — fill the screen, fix what's actually broken

**Files:**
- Modify: whichever individual screen files under `src/features/*/​*Screen.tsx` turn out to need a
  small fix (exact files depend on what Step 2's review finds — not knowable in advance).

**Interfaces:**
- Consumes: Task 1 (iPad no longer letterboxed) and Task 2 (`WIDE_CONTENT_MAX_WIDTH` cap) both
  merged into this branch already.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Boot the iPad Simulator with both fixes in place**

```bash
npm run mock-gateway &
xcrun simctl boot "iPad Pro 13-inch (M5)" 2>&1 || true
open -a Simulator
npx expo run:ios --device "iPad Pro 13-inch (M5)"
```

Log in with the mock credentials (`matias` / `mock` / `000000`).

- [ ] **Step 2: Screenshot and review each main screen**

Using the `idb`-based tap/screenshot method documented in
`.claude/skills/ops-run/SKILL.md` §7 (`ui describe-all` for exact tap coordinates, `screenshot` to
capture), visit and screenshot each of:

- Status (`/`)
- Jugadores directory (`/players`)
- A player detail screen (tap into any row from the directory)
- Logs (`/logs`)
- Chat (`/chat`)
- Sistema IA / ORACLE screens (`/oracle`, and its sub-screens reachable from there: composer, event
  trigger, ORACLE chat)
- Más (`/more`)
- Auditoría (reachable from Más)
- Operadores (reachable from Más)

For each, check against the design's own bar (`docs/specs/2026-08-27-tablet-full-screen-design.md`,
"Fix 3"): does content fill the 960px-capped column reasonably, with no obviously broken padding, a
control stranded awkwardly in a lot of empty space, or a list/divider that visibly stops short of
where it should extend? Note every real issue found before fixing any of them, so Step 3 can fix
them as one batch rather than screenshot-fix-screenshot-fix serially.

- [ ] **Step 3: Fix genuine issues found in Step 2**

Apply the smallest change that fixes each real issue found — typically a padding/width className
adjustment on the specific row/card/section involved, following whatever spacing convention that
screen's file already uses elsewhere (e.g. if a screen already uses `px-6` throughout, match it
rather than introducing a new value). Do not add multi-column layouts, do not add
breakpoint-specific branches inside individual feature screens (`useBreakpoint()` usage stays
confined to `Screen.tsx`/`app/(tabs)/_layout.tsx`, per the design's own constraint) — if a fix seems
to need per-screen breakpoint awareness, that's a signal that fix belongs in a future,
separately-scoped ticket, not this plan; note it instead of building it.

If no real issues are found in Step 2, this step is a no-op — say so plainly in the task report
rather than inventing cosmetic changes to justify the task.

- [ ] **Step 4: Re-screenshot anything that was changed, confirm the fix**

For each file touched in Step 3, re-screenshot the affected screen and confirm the issue is
resolved and nothing else regressed.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
git add -A
git commit -m "fix(tablet): address iPad content-layout issues found in visual review"
```

If Step 3 was a no-op, skip this commit (nothing to commit) and say so in the task report instead.

---

### Task 4: Android tablet emulator verification (best-effort) + final cross-platform checks

**Files:**
- None expected — this task is verification-only unless it surfaces a real Android-specific bug,
  in which case treat any fix the same way Task 3 does (smallest change, matching existing
  conventions, report it).

**Interfaces:**
- Consumes: Tasks 1-3 all merged into this branch.
- Produces: nothing — this is the plan's final task.

- [ ] **Step 1: Confirm an appropriate tablet device profile exists**

```bash
export ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/avdmanager list device | grep -iB2 "pixel_tablet\|Nexus 10\|tablet"
```

Expected: at least one tablet-shaped device id listed (`pixel_tablet` is the most likely match on a
reasonably current SDK; `Nexus 10` is the fallback if it's the only tablet profile present). Use
whichever concrete id this command actually returns for Step 2 — do not guess if neither appears.

If **no** tablet device profile is listed at all, stop here, record that in the task report, and
skip straight to Step 5 (static-only verification) — per this plan's own Global Constraints, this
step is best-effort and must never block finishing the plan.

- [ ] **Step 2: Create the AVD, reusing the already-installed system image**

```bash
echo "no" | $ANDROID_SDK_ROOT/cmdline-tools/latest/bin/avdmanager create avd \
  -n xindeler-ops-tablet-test \
  -k "system-images;android-36;google_apis;arm64-v8a" \
  -d "pixel_tablet"
```

(`echo "no"` answers avdmanager's "create a custom hardware profile?" prompt with the default —
same non-interactive pattern as any scripted `avdmanager` invocation. Substitute `-d` with whatever
concrete device id Step 1 actually found if it wasn't `pixel_tablet`.)

Expected: `Created AVD 'xindeler-ops-tablet-test'...` with no error. If this fails for any reason
(missing licenses, disk space, an incompatible device/image pairing), record the exact error in the
task report and fall through to Step 5 — do not spend more than one retry debugging emulator
tooling itself, per this step's best-effort framing.

- [ ] **Step 3: Boot the emulator and run the app**

```bash
$ANDROID_SDK_ROOT/emulator/emulator -avd xindeler-ops-tablet-test &
```

Wait for the emulator to finish booting (`adb wait-for-device`, then poll
`adb shell getprop sys.boot_completed` until it prints `1`), then:

```bash
npm run mock-gateway &
npx expo run:android
```

- [ ] **Step 4: Screenshot and confirm**

```bash
adb shell screencap -p /sdcard/tablet-check.png
adb pull /sdcard/tablet-check.png /tmp/android-tablet-check.png
```

Expected: the app fills the emulator's full screen (Android has no `supportsTablet`-equivalent
restriction, so this is confirming the existing behavior, not a fix), and the `SidebarLayout` +
`WIDE_CONTENT_MAX_WIDTH` cap from Task 2 render sensibly at this screen size too, matching the same
bar Task 3 applied on iPad. Note anything genuinely broken in the task report; only fix it if it's
a small, obviously-scoped issue (same discipline as Task 3, Step 3) — this platform is explicitly
lower priority than iPhone/Android-phone/web/iPad per Matías's own ordering.

- [ ] **Step 5: Final full-repo checks (run regardless of how Steps 1-4 went)**

```bash
npx tsc --noEmit
npm run lint
npm run format:check
```

Expected: all clean, same as every prior task. Commit any Step 4 fixes if there were any:

```bash
git add -A
git commit -m "fix(tablet): address Android-tablet-specific issue found in emulator review"
```

If nothing needed fixing (the common case, since Android has no known blocking issue), there is
nothing to commit for this task — say so in the task report.

---

## Testing

Covered per-task above; summarized here for the final whole-branch review:

- iPhone: unaffected (Task 2, Step 3).
- Web: unaffected narrow, correctly capped wide (Task 2, Steps 3-4).
- iPad: no more letterboxing (Task 1), content fills the capped width sensibly across all main
  screens (Task 3).
- Android tablet: best-effort emulator confirmation (Task 4), never a blocker.
- `npx tsc --noEmit` / `npm run lint` / `npm run format:check`: clean after every task.

## Explicitly out of scope

- Any multi-column, master-detail, or side-by-side tablet-specific layout redesign.
- Per-screen or per-content-type width tiers — one shared cap in `Screen.tsx` only.
- Any Android phone or web behavior change beyond what Task 2's shared `Screen.tsx` change
  naturally applies identically across platforms.
- A real, physical Android tablet test — none is available to Matías.

# Android Platform Verification (OC-36a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declare edge-to-edge explicitly and re-enable predictive-back on Android, and verify —
with a real emulator, not just code reading — that back-button semantics, edge-to-edge insets, and
the existing notification channel already work correctly.

**Architecture:** A two-line config change in `app.config.ts`'s `android` block. No component or
UI code changes — the three areas this ticket covers (back-button, notification channels,
edge-to-edge) were already found, by prior investigation, to be either fully handled by the
framework/existing code or one config flag away from correct. This task's real work is running a
live Android build and confirming that holds.

**Tech Stack:** Expo config (`app.config.ts`), Android emulator (`xindeler-ops-test` AVD).

## Global Constraints

- Single file changed: `app.config.ts`. No component/UI code touched.
- `npx tsc --noEmit`, `npm run lint`, `npm run format:check` must all stay clean.
- **Mandatory real manual verification on a real Android emulator** — this ticket's whole point is
  verifying areas that were already suspected-working from code reading, not building new code.
  Do not mark this task done from a clean `tsc`/lint alone.
- Design doc: `docs/specs/2026-08-21-android-platform-verification-design.md`.

---

## Task 1: Flip the two config flags and verify on a real Android emulator

**Files:**
- Modify: `app.config.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the only task).
- Produces: nothing consumed elsewhere — this is a leaf config change with no code interface.

- [ ] **Step 1: Update `app.config.ts`**

Current `android` block:

```ts
  android: {
    package: 'com.xindeler.overlord',
    adaptiveIcon: {
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundColor: '#0B0F14',
    },
    predictiveBackGestureEnabled: false,
  },
```

Replace with:

```ts
  android: {
    package: 'com.xindeler.overlord',
    adaptiveIcon: {
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundColor: '#0B0F14',
    },
    edgeToEdgeEnabled: true,
    // Re-enabled 2026-08-21 (OC-36a) — this was `false` from the original OC-3 scaffold with no
    // documented reason. RN `Modal`'s `onRequestClose` and expo-router's own back-handling both
    // fire from the same underlying back-press event regardless of this flag; predictive-back
    // only adds Android 13+'s preview animation/gesture on top, it doesn't change what fires.
    predictiveBackGestureEnabled: true,
  },
```

No other line in the file changes.

- [ ] **Step 2: Type-check, lint, format**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: 0 errors.

Run: `npm run format:check`
Expected: clean (run `npm run format` first if it reports an issue on this file).

- [ ] **Step 3: Commit**

```bash
git add app.config.ts
git commit -m "feat(oc36a): declare Android edge-to-edge, re-enable predictive back gesture"
```

- [ ] **Step 4: Mandatory manual verification on a real Android emulator**

This step is required, not optional — do not report this task done without completing checks 1-3
below; check 4 is best-effort.

Set `JAVA_HOME` to JDK 17 or 21 before building (this repo's `ops-run` skill notes the system
default is JDK 26, which breaks RN's Gradle build):

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
```

Start the mock gateway (`npm run mock-gateway`) if it isn't already running, then
`npx expo run:android` against the `xindeler-ops-test` AVD (boot it first via `emulator` /
Android Studio's Device Manager if it isn't already running). Log in as `matias`/mock, TOTP
`000000`.

**(1) Back button closes a real modal, like tapping "Cancelar":**

Open a real `ConfirmByTypingSheet` (e.g. Status → a restart/stop confirmation) or `StepUpPrompt`
(any step-up-gated action). Press Android's back button/gesture. Confirm the sheet closes exactly
as tapping "Cancelar" would — no crash, no partial action taken, typed text cleared if you reopen
it. Take an emulator screenshot (`adb shell screencap` or Android Studio's screenshot tool) before
and after as evidence.

**(2) Back button navigates between screens correctly:**

Navigate to a nested screen reached via a link (e.g. Más → Auditoría). Press back. Confirm it
returns to the previous screen (Más) rather than exiting the app or doing nothing. This should
require zero app code (expo-router handles it) — the check confirms that's actually true live,
not just in theory.

**(3) Edge-to-edge — content isn't hidden under system bars:**

On the Status tab (has `EnvironmentBadge` right at the top and content extending toward the
bottom), confirm no content renders underneath the Android status bar (top) or the gesture/nav
bar (bottom). Take a screenshot as evidence.

**(4) Notification channel (best-effort):**

If straightforward, inspect the app's registered notification channels without needing to trigger
a real push — either via the emulator's own Settings → Apps → Overlord → Notifications screen, or
`adb shell dumpsys notification` filtered for the app's channel list. Confirm a `default` channel
exists with high/max importance. If this isn't straightforward to check cleanly, skip it and say
so in your report — `PushTokenServiceImpl.native.ts`'s `ensureAndroidChannel()` is not touched by
this ticket, this check is a nice-to-have, not a requirement.

Record the outcome of all four checks in your report — this is the acceptance evidence for the
whole ticket, not just Step 2's type-check/lint.

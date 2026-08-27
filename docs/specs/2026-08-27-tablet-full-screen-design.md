# Tablet Full-Screen Layout Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop the app from rendering letterboxed/phone-sized on iPad, and make the wide-breakpoint
layout use the available screen space well (not edge-to-edge, not untouched) across the app's main
screens.

**Architecture:** Two independent fixes, one config change and one shared-component change, plus a
verification pass:

1. iOS: set `ios.supportsTablet: true` in `app.config.ts` — the actual root cause of the reported
   bug. Without it, iOS runs the app in iPhone-compatibility mode on iPad: a phone-sized window,
   letterboxed, centered on the device screen, regardless of any React layout code.
2. All platforms at the existing `'wide'` breakpoint (`useBreakpoint()` — already `>= 768px` wide or
   landscape): cap and center screen content at a moderate max-width inside the one shared
   `Screen` wrapper every route already uses, instead of stretching content edge-to-edge on a large
   tablet. `'phone'` breakpoint is untouched.
3. Verify on a real iPad Simulator (already have working tap/text automation from OC-35) and a
   newly-created Android tablet emulator (reusing the already-installed SDK image, no new
   download) — fix anything that looks genuinely broken or wasteful once real full-width rendering
   is in effect. Not a from-scratch tablet redesign.

**Tech Stack:** Same as the rest of the app — Expo SDK 57, React Native 0.86, NativeWind/Tailwind
CSS 3, Expo Router. No new dependencies.

## Global Constraints

- `'phone'` breakpoint behavior must not change in any way — every change here is gated on
  `useBreakpoint() === 'wide'`.
- Android and web must not be affected by the iOS config change (`supportsTablet` is
  `ios`-scoped in `app.config.ts`).
- No per-screen bespoke width logic — the max-width cap lives in exactly one place (`Screen.tsx`,
  `src/ui/Screen.tsx`), which reaches every route that renders through it: the 13 routes under
  `app/(tabs)/` (confirmed: every `app/(tabs)/*.tsx` route file is a thin
  `<Screen><FeatureScreen /></Screen>` wrapper — zero feature screens import `Screen` directly) plus
  the 3 `(auth)` routes that also wrap with `Screen` (`login.tsx`, `totp.tsx`, `environment.tsx`) —
  16 routes total.
- This is explicitly **not** a tablet-specific redesign: no new multi-column/master-detail layouts,
  no per-content-type width tiers. One shared cap, applied uniformly, tuned by eye against the real
  simulator.
- Manual verification required on: iPhone (unaffected, but confirm), web (unaffected, but confirm),
  iPad (the actual fix), and a newly-created Android tablet emulator (best-effort, since Matías has
  no physical Android tablet) — same bar as this repo's own `ops-run` skill ("at least two
  platforms" for any UI change), extended here to cover every platform actually in scope per
  Matías's own priority order (phones, web, then iPad; Android tablet is a bonus, not a blocker).

---

## Root cause: iOS compatibility mode (confirmed, not guessed)

`app.config.ts`'s `ios` block currently has no `supportsTablet` key:

```ts
ios: {
  bundleIdentifier: 'com.xindeler.overlord',
  config: {
    usesNonExemptEncryption: false,
  },
},
```

Expo's default for `ios.supportsTablet` is `false`. An iOS app without this flag is marked
iPhone-only in its `Info.plist` (`UIDeviceFamily = [1]`); iPadOS runs such an app in a fixed
iPhone-sized window (optionally scaled 2x, "Zoomed"), centered on the iPad's screen with empty
space around it — this is exactly what Matías described ("la screen de la app se ajusta al tamaño
de un celular"), and it happens entirely at the OS/window level, before any React code runs. No
amount of flexbox or `useBreakpoint()` logic can fix this — it's not a layout bug, it's a missing
capability declaration.

Android has no equivalent mechanism blocking this: no `resizeableActivity`, `<supports-screens>`,
or forced `screenOrientation` restriction was found in `android/app/src/main/AndroidManifest.xml`
or `app.config.ts`'s `android` block. An Android tablet should already receive the app's real
window size from the OS today. The complaint may not reproduce there at all — see Testing.

## Fix 1 — iOS: `supportsTablet`

**File:** `app.config.ts`

```ts
ios: {
  bundleIdentifier: 'com.xindeler.overlord',
  supportsTablet: true,
  config: {
    usesNonExemptEncryption: false,
  },
},
```

This is a native capability declaration, not a JS-only change — it requires regenerating the native
iOS project (`npx expo prebuild -p ios --clean`) so the new `Info.plist` entry takes effect, then a
fresh `npx expo run:ios` build to verify. The existing `ios/` directory (already prebuilt from an
earlier session) will be regenerated in place.

## Fix 2 — shared max-width cap at the wide breakpoint

**File:** `src/ui/Screen.tsx` (current content, for reference):

```tsx
export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} className="flex-1 bg-bg-base dark:bg-night-bg-base">
      <View className="flex-1 bg-bg-base dark:bg-night-bg-base">{children}</View>
    </SafeAreaView>
  );
}
```

Change: when `useBreakpoint() === 'wide'`, wrap `children` in an additional `View` that centers
content and caps its width; when `'phone'`, render exactly as today (no additional wrapper, no
behavior change).

Starting cap: **960px** (`max-w-[960px]`), centered (`mx-auto`), full width below that (`w-full`).
This is a ceiling, not a fixed width — on an iPad in portrait, `SidebarLayout`'s content pane
(device width minus the 220px sidebar) is already narrower than 960px on every current iPad model,
so the cap does nothing there; it only visibly centers content on genuinely wide layouts (landscape
iPad, iPad Pro, wide web windows), which is exactly where the "wasted space" complaint applies. The
exact number is a starting point, not a commitment — Testing calls for tuning it by eye against the
real iPad Simulator before considering this done, since no static analysis can substitute for
looking at it.

`Screen` is the only file this touches. Every route's feature screen keeps its own internal padding
(e.g. `px-6`) exactly as today — the cap composes with that padding rather than replacing it.

## Fix 3 — verification pass, fix what's actually broken

Once `supportsTablet` is in and rebuilt, the app will render at real iPad width for the first time
in this project's history. Some individual screens may still look sparse, oddly stretched, or waste
the newly-available space even inside the 960px cap (e.g. a list row that was designed assuming a
~360px phone column) — Fix 2 raises the ceiling but doesn't guarantee everything under it looks
good. This step is a **visual review, not a redesign**: check each of the app's main screens live on
the iPad Simulator (Status, Jugadores directory, player detail, Logs, Chat, Sistema IA screens,
Más, Auditoría, Operadores) and fix anything that looks genuinely broken or wasteful — inconsistent
padding, a row that doesn't stretch to the new width when it obviously should (e.g. a full-bleed
list divider), a control that's now oddly small in the middle of a lot of empty space. Explicitly
out of scope: multi-column lists, side-by-side master-detail, or any layout restructuring beyond
what the max-width cap already provides — Matías asked for "que se vea bien... sin exagerar", not a
tablet-specific redesign.

## Testing

- **iPhone (Simulator):** confirm zero visual/behavioral change before and after — screenshot
  comparison on at least one representative screen (Status) and the tab bar (still `<Tabs>`, not
  `SidebarLayout`, since phone width is unaffected by `useBreakpoint()`'s unchanged threshold).
- **Web:** confirm the existing dev server still renders correctly at both a phone-narrow and a
  wide browser window — `supportsTablet` doesn't touch web config at all, but the `Screen.tsx`
  change is shared across all platforms including web, so this needs its own check.
- **iPad (Simulator, the primary fix):** after `expo prebuild -p ios --clean` + `expo run:ios`,
  confirm the app fills the full iPad screen (no letterboxing) in both portrait and landscape, using
  the same `idb`-based tap/screenshot automation documented in `.claude/skills/ops-run/SKILL.md`
  §7 (from OC-35's own native-verification pass). Visually review each screen listed in Fix 3.
- **Android tablet (emulator, best-effort):** Matías has no physical Android tablet to test on.
  Create a new AVD using a large-screen device profile (e.g. "Pixel Tablet" or similar) paired with
  the **already-installed** `system-images;android-36;google_apis;arm64-v8a` image (no new
  download — AVD screen size is a device-profile choice, independent of the system image) via
  `avdmanager`/Android Studio's AVD manager. Confirm the app fills the emulator's screen and the
  `SidebarLayout`/max-width cap render sensibly. If AVD creation or the emulator itself turns out to
  be impractical in this environment, this step is explicitly allowed to fall back to static
  config verification only (already done above: no manifest restriction found) — Android tablet is
  the lowest-priority platform per Matías's own ordering, not a blocker for the rest of this work.
- `npx tsc --noEmit`, `npm run lint`, `npm run format:check` — same bar as every other change in
  this repo.

## Explicitly out of scope

- Any tablet-specific multi-column, master-detail, or side-by-side layout redesign.
- Per-screen or per-content-type width tiers (forms vs. lists) — one shared cap, per Matías's own
  "sin exagerar" direction.
- Android phone or web behavior changes of any kind.
- A real, physical Android tablet test — no such device is available to Matías; the emulator pass
  is best-effort.

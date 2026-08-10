# Navigable shell — theme + navigation skeleton (OC-10, OC-11)

**Date:** 2026-08-10 · **Status:** approved, implementing.

## Goal

An app that feels intentional and navigable on iPhone, iPad, and Web — no real data yet. This is
the first slice of Phase 1, chosen so Matías has something to click through on his own devices
before any backend work (mock gateway, auth) exists. Android is out of scope for now (parked per
OC-7/Play verification); the code stays cross-platform regardless since that costs nothing extra
in Expo/React Native.

## Scope

**In:**
- Theme/design tokens: dark-first, `prefers-color-scheme` on web, one spacing scale, one
  typography scale (OC-10).
- Two UI primitives: `Screen` (safe-area + background wrapper) and `Empty` (placeholder state).
  The other ~12 primitives listed in `.claude/skills/ops-ui/SKILL.md` (`Card`, `StatusPill`,
  `DangerButton`, etc.) are **not** built yet — YAGNI until a real screen needs them.
- Navigation shell with 5 destinations: Status, Players, Logs, ORACLE, More (OC-11).
- Responsive layout: bottom tabs on phone, persistent sidebar + content pane on tablet/desktop/wide
  web (≥768pt), same 5 routes, no duplicated route trees.
- Each screen renders `Screen` + `Empty` with a Spanish placeholder message ("Fase 1 — todavía sin
  conexión al gateway" or similar per-screen copy).

**Out:** any real data, the mock gateway (OC-13), auth (OC-15/16), the other 12 UI primitives,
Android manual verification.

## Architecture

**Routing:** one Expo Router route group, `app/(tabs)/`, with five screen files (`status.tsx`,
`players.tsx`, `logs.tsx`, `oracle.tsx`, `more.tsx`). A single `app/(tabs)/_layout.tsx` reads
`useWindowDimensions()` via a small `useBreakpoint()` hook (`src/ui/useBreakpoint.ts`) and renders:
- `< 768pt`: Expo Router's native `<Tabs>` (bottom tab bar, platform-correct press feedback per
  `ops-ui` SKILL.md's table).
- `>= 768pt`: a persistent sidebar (nav list, always visible) + `<Slot />` for the active screen's
  content, laid out with a `View` in `flex-row`.

This avoids two parallel navigator trees for the same 5 destinations — one set of route files,
one layout component branching on breakpoint.

**Theme:** `src/ui/theme.ts` exports a `theme` object (colors for light + dark, spacing scale,
typography scale) and a `useTheme()` hook that reads the system color scheme
(`useColorScheme()`), matching OC-10's "prefers-color-scheme on web" requirement. NativeWind
config (`tailwind.config.js`) reads the same token values so `className` usage and the
`useTheme()` hook never drift apart.

**Primitives (`src/ui/`):**
- `Screen`: safe-area wrapper + themed background. Every screen composes this.
- `Empty`: icon/text placeholder for "nothing here yet" states — reused later for genuinely empty
  data (e.g. no players online), not just Phase-0 stubs.
- Both import nothing but the theme, per the existing layering rule in `CLAUDE.md`.

## Visual identity

Real brand assets landed 2026-08-10 in `~/MyXindeler/imagenes-assets/Overlord/`: a corrected app
icon (`overlord_app-icon.png` — old `assets/images/icon.png` had wasted black padding around the
artwork; the new one is full-bleed), an "O" gem mark for a future loading-screen glow effect
(deferred — not native-Expo-splash-compatible, needs a custom animated component, out of scope for
this slice), and three hero-illustration backgrounds (vertical/horizontal/web) — gothic-steampunk
cathedral scenes with the Overlord crest, reserved for a future login/loading screen, **not** used
behind the data-dense tab screens (would fight the "instrument panel" legibility rule in
`ops-ui` SKILL.md — those screens keep the plain dark background color).

**Color tokens** (eyeballed from the assets, refine visually once rendered):
| Token | Hex (approx.) | Use |
|---|---|---|
| `bg.base` | `#0B0F14` | screen background (already matched the placeholder) |
| `bg.surface` | `#131B24` | cards/panels, one step up from base |
| `accent.cyan` | `#3AD6FF` | primary accent — glow, active states, links |
| `accent.cyanMuted` | `#1C8FB0` | secondary accent — less emphasis |
| `steel.light` | `#B9C4CE` | primary text on dark, metal highlights |
| `steel.dark` | `#3A4550` | borders, dividers, disabled state |

**Typography:** the gothic "OVERLORD" wordmark in the assets is baked into the artwork, not a font
file — used as a static image wherever the wordmark itself appears (not this slice). Body/UI text
uses **Inter** (`@expo-google-fonts/inter`) — excellent legibility and numeral rendering, which
matters for a stats-heavy ops console; a safe, easily-swappable default.

**Icon replacement:** `assets/images/icon.png`, `favicon.png`, and `splash-icon.png` are replaced
with the corrected `overlord_app-icon.png`. `android-icon-foreground.png` is also swapped for now
but flagged as imperfect — Android adaptive icons need generous transparent safe-zone padding
around the subject, which this asset doesn't have; acceptable since Android isn't being tested this
round (OC-7 pending), fix when Android work resumes. A follow-up asset request is worth making for
a true edge-to-edge icon source (no baked-in rounded-square border) so iOS's own corner mask
doesn't double up with one already in the artwork — noted for the image-prompt list Matías asked
for, not blocking now.

**Orientation:** `app.config.ts`'s `orientation: 'portrait'` becomes `orientation: 'default'`
(unlocked, follows device rotation) so iPad gets landscape — simpler than fighting per-idiom native
config for iPhone-portrait-only + iPad-both. iPhone landscape becomes technically possible too as a
side effect; no screens are landscape-optimized yet in this slice, so it'll just look like a wider
portrait layout until that's addressed, if ever.

## Platform handling

Per `ops-ui` SKILL.md's table: safe areas (notch/Dynamic Island on iPhone, none on web), tab bar
vs. sidebar as described above, and `Platform.select`/`.web.tsx` overrides only where genuinely
needed (expected to be minimal for this slice — mostly the breakpoint-driven layout branch, not
per-file platform forks).

## Testing

Verified by running on iOS simulator (iPhone + iPad) and `expo start --web`, resized to confirm
the ≥768pt breakpoint switches from tabs to sidebar. Android not manually verified this round.

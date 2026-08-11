# Environment/profile switcher (OC-12)

**Date:** 2026-08-10 · **Status:** approved, implementing.

## Goal

The app must never let Matías confuse which server he's pointed at — the base URL for the gateway
comes from a persisted, user-visible profile selection, never a hardcoded value. This is app-side
plumbing only: no live backend exists yet (OC-13 is the mock gateway, not built), so this just
gives OC-13/OC-14 something real to plug into and gives the UI its "which environment am I in"
affordance from day one, per `ops-run` SKILL.md §4 and `docs/backlog.md`'s OC-12 row.

## Scope

**In:**
- Two profiles: `mock` (`http://localhost:4000` — provisional, OC-13 doesn't exist yet, adjust the
  port when it does) and `wireguard` (`http://10.77.0.1:19260` — confirmed real value from
  `docs/reference/gateway-api-contract.md`).
- Persisted selection (`@react-native-async-storage/async-storage`, new dependency — this is a
  non-secret preference, not a session token, so `expo-secure-store` is the wrong tool per OC-15's
  scope). Default on first launch: `mock` (the safe default).
- A persistent, always-visible indicator of the active profile, rendered once in
  `app/(tabs)/_layout.tsx` (not inside `Screen`, which may only import the theme) so every tab gets
  it automatically.
- A real switcher UI replacing the "Más" tab's current placeholder.

**Out:** the `public` profile (no hostname/posture decided for `xindeler-zuul` yet — do not add it
speculatively), any actual network call using the resolved base URL (that's OC-14, the API client),
auth of any kind.

## Architecture

- `src/config/environments.ts` — `Environment` type (`id`, `label`, `baseUrl`) and a
  `ENVIRONMENTS` record/array with the two entries above.
- `src/config/EnvironmentContext.tsx` — a `EnvironmentProvider` (mounted in `app/_layout.tsx`,
  alongside the existing font-loading logic) + `useEnvironment()` hook returning
  `{ environment, setEnvironment }`. Loads the persisted choice on mount (AsyncStorage), defaults to
  `mock` if nothing stored yet, persists on every change.
- `src/features/environment/EnvironmentBadge.tsx` — the persistent strip. Reads `useEnvironment()`,
  renders the active profile's label. Optionally tappable to navigate to `/more` (nice-to-have, skip
  if it adds real complexity — not a hard requirement).
- `src/features/environment/EnvironmentSwitcher.tsx` — the full switcher: lists both profiles,
  tapping one calls `setEnvironment()`. Replaces `app/(tabs)/more.tsx`'s current `Empty` placeholder.
- Both new `features/` files may import `@/config/*` and `@/ui/*` per the project's layering rule
  (`ui/` imports only the theme; `features/` may import `api/`/`stream/`/`ui/`/`auth/` — `config/` is
  treated the same as `theme/`: broadly available static configuration, not a layering violation).

## Testing

No automated test runner in this repo. Verify via `npm run typecheck && npm run lint`, and a visual
check on at least one target (web, since that's what's available without a full simulator pass) to
confirm the badge renders and the switcher actually persists across a reload.

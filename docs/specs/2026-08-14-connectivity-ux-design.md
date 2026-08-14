# Connectivity UX (OC-22) design

## Problem

Phase-1 posture is WireGuard-only (`docs/reference/gateway-api-contract.md` §"Phase-1 network
posture", `docs/specs/2026-08-09-client-architecture-design.md` §5.4). When the tunnel is down,
every request to `10.77.0.1:19260` fails at the network layer — not a 4xx/5xx from the gateway, a
`fetch` failure. `src/api/httpClient.ts` already converts that into `ApiError('network_error', 'No
se pudo conectar con el gateway', 0)` (a fetch throw) or `ApiError('timeout', 'La solicitud tardó
demasiado', 0)` (the 10s `AbortController` firing), and every screen already renders `query.error`
via `Empty` once `query.data === undefined` — so today's actual gap isn't an infinite spinner (that
concern is already handled structurally), it's that the message is generic and gives the operator no
actionable next step. §5.4's own framing: *"the app must detect that specific failure mode and say so
in plain language, with a deep link to the WireGuard app — not a generic error... getting this wrong
makes the app feel broken most of the time it is opened."*

## Detecting "probably the tunnel"

`httpClient` cannot know *why* `fetch` failed (RN/web `fetch` gives no DNS-vs-refused-vs-no-route
detail) — but the app doesn't need certainty, it needs the right first troubleshooting step. On the
`wireguard` environment profile specifically, a `network_error` or `timeout` has no other realistic
cause in normal operation (there's no public vhost to route around, no other network path to the
gateway at all) — so both codes are treated as "probably the tunnel" when the active profile is
`wireguard`. On `mock` (dev-only, `localhost`), neither code implies anything VPN-related — behavior
there is unchanged from today.

This is a heuristic, not a certainty (a `timeout` could theoretically mean a slow gateway with the
tunnel fine) — but "check your VPN" is a safe, low-cost first suggestion even when wrong, and it's
the only network-layer signal actually available. `network_error`/`timeout` on any *other* code (a
real HTTP status, meaning the tunnel is up and the gateway answered) is never treated this way — a
500 is a gateway bug, not a connectivity problem, and must not tell the operator to check their VPN.

New `src/features/connectivity/gatewayErrorMessage.ts`:

```ts
import { isApiError } from '@/api';
import type { EnvironmentId } from '@/config/environments';

const VPN_SUSPECT_CODES = new Set(['network_error', 'timeout']);

export const VPN_DOWN_MESSAGE = 'No llego al gateway — ¿está la VPN prendida?';

export function isLikelyVpnDown(environmentId: EnvironmentId, error: Error): boolean {
  return (
    environmentId === 'wireguard' && isApiError(error) && VPN_SUSPECT_CODES.has(error.code)
  );
}

export function gatewayErrorMessage(environmentId: EnvironmentId, error: Error): string {
  return isLikelyVpnDown(environmentId, error) ? VPN_DOWN_MESSAGE : error.message;
}
```

## The WireGuard deep link — Android only, and here's why

§5.4 asks for "a deep link to the WireGuard app." Researched before designing this, rather than
guessing: there is no publicly documented, reliable URL scheme for launching the WireGuard app (or
toggling a tunnel) from another app on **iOS** — the official app doesn't register one, and iOS's own
`App-Prefs:` private-scheme trick for jumping into Settings has been unreliable/blocked on modern iOS
for third-party apps for years. Shipping a button that silently no-ops (or that `Linking.openURL`
rejects) is worse than not shipping one — an operator who taps a dead button loses trust in every
other button in the app.

**Android** has a real, documented, OS-level answer that doesn't require knowing which VPN client is
installed: `Settings.ACTION_VPN_SETTINGS` (`"android.settings.VPN_SETTINGS"`), a public Android intent
action that opens the system's VPN settings screen — where WireGuard (or any VPN app configured via
Android's `VpnService`, which is how the official WireGuard app integrates) already shows up. React
Native's core `Linking.sendIntent(action)` calls this directly. This is more useful than a scheme that
might open the WireGuard app to its main list screen anyway — VPN settings is where the toggle
actually lives on stock Android.

So: **Android gets a real, working button. iOS and web get the text message only** — the message
itself ("¿está la VPN prendida?") is the actionable content; on iOS the operator opens Settings → VPN
manually, and web has no VPN concept at the OS level, this app running in a browser at all implies
some other network path.

New `src/features/connectivity/openVpnSettings.ts`:

```ts
import { Linking, Platform } from 'react-native';

export function canOpenVpnSettings(): boolean {
  return Platform.OS === 'android';
}

export function openVpnSettings(): void {
  if (Platform.OS !== 'android') return;
  Linking.sendIntent('android.settings.VPN_SETTINGS').catch((error) => {
    console.error('[connectivity] failed to open VPN settings', error);
  });
}
```

New `src/features/connectivity/VpnSettingsButton.tsx` — self-hiding (returns `null` on iOS/web), a
secondary/outline pill matching `FollowTailToggle`'s established visual language for a non-primary
action (not `src/ui/Button.tsx`'s solid full-width CTA style, which would visually compete with a
screen's actual primary action, e.g. Login's "Ingresar"):

```tsx
import { Pressable, Text } from 'react-native';

import { fonts } from '@/ui/theme';

import { canOpenVpnSettings, openVpnSettings } from './openVpnSettings';

export function VpnSettingsButton() {
  if (!canOpenVpnSettings()) return null;
  return (
    <Pressable
      onPress={openVpnSettings}
      accessibilityRole="button"
      className="mt-3 rounded-full border border-accent-cyan px-4 py-2 dark:border-night-accent-cyan"
    >
      <Text
        className="text-accent-cyan dark:text-night-accent-cyan"
        style={{ fontFamily: fonts.semibold }}
      >
        Abrir ajustes de VPN
      </Text>
    </Pressable>
  );
}
```

This file lives in `src/features/connectivity/`, not `src/ui/` — `src/ui/` is domain-free (theme
only, per OC-12's established constraint), and this component reaches into
`openVpnSettings.ts`.

## Where the messaging surfaces

**1. The four data screens' existing "no data yet + error" state** (`StatusScreen.tsx`,
`PlayersScreen.tsx`, `LogsScreen.tsx`, `ChatScreen.tsx`) — this is the scenario §5.4 actually names:
first load with the tunnel down, every request failing, nothing on screen yet. All four already share
the identical shape:
```tsx
if (query.data === undefined) {
  if (query.error) {
    return <Empty title="X" message={query.error.message} />;
  }
  return <Empty title="X" message="Cargando…" />;
}
```
`Empty` (`src/ui/Empty.tsx`) gains an optional `children: ReactNode` slot rendered below the message
— a minimal, backward-compatible addition (no new import, every existing call site unaffected):
```tsx
export function Empty({
  title,
  message,
  children,
}: {
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Text ...>{title}</Text>
      <Text ...>{message}</Text>
      {children}
    </View>
  );
}
```
New `src/features/connectivity/GatewayErrorEmpty.tsx` composes `Empty` with the message-selection and
button logic, so the four screens change one line each (`<Empty title="X" message={query.error.message} />`
→ `<GatewayErrorEmpty title="X" error={query.error} />`) instead of each screen reimplementing the
same environment-aware branching:
```tsx
import { useEnvironment } from '@/config/EnvironmentContext';
import { Empty } from '@/ui/Empty';

import { gatewayErrorMessage, isLikelyVpnDown } from './gatewayErrorMessage';
import { VpnSettingsButton } from './VpnSettingsButton';

export function GatewayErrorEmpty({ title, error }: { title: string; error: Error }) {
  const { environment } = useEnvironment();
  return (
    <Empty title={title} message={gatewayErrorMessage(environment.id, error)}>
      {isLikelyVpnDown(environment.id, error) && <VpnSettingsButton />}
    </Empty>
  );
}
```

**2. Login and TOTP screens** (`app/(auth)/login.tsx`, `app/(auth)/totp.tsx`) — an operator who can't
even log in because the tunnel is down is arguably the *most* common way this gets noticed, and
today's error handling is the least helpful here: `err instanceof ApiError ? err.message :
'No se pudo conectar con el gateway'`, a plain string with no environment awareness. Both screens
change their `error` state from `string | null` to `Error | null` so the render can call
`gatewayErrorMessage`/`isLikelyVpnDown` (which need the environment + the original error, not just a
pre-flattened string). Both screens need a new `useEnvironment` import (not currently imported in
either file) — the provider itself is already available app-wide (`EnvironmentProvider` wraps the
whole tree in `app/_layout.tsx`), only the hook call is missing at these two call sites.

`login.tsx`'s current shape:
```tsx
const [error, setError] = useState<string | null>(null);
// ...
} catch (err) {
  setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el gateway');
}
// ...
{error && (
  <Text className="text-center text-sm text-danger dark:text-night-danger">{error}</Text>
)}
```
becomes:
```tsx
import { useEnvironment } from '@/config/EnvironmentContext';
import { gatewayErrorMessage, isLikelyVpnDown } from '@/features/connectivity/gatewayErrorMessage';
import { VpnSettingsButton } from '@/features/connectivity/VpnSettingsButton';
// ...
const { environment } = useEnvironment();
const [error, setError] = useState<Error | null>(null);
// ...
} catch (err) {
  setError(err instanceof Error ? err : new Error('No se pudo conectar con el gateway'));
}
// ...
{error && (
  <>
    <Text className="text-center text-sm text-danger dark:text-night-danger">
      {gatewayErrorMessage(environment.id, error)}
    </Text>
    {isLikelyVpnDown(environment.id, error) && <VpnSettingsButton />}
  </>
)}
```
`totp.tsx` gets the identical treatment (same current shape, same `err instanceof ApiError ? err.message : '...'` pattern, same fix). In both files, `ApiError` is no longer referenced directly (`err instanceof Error` replaces `err instanceof ApiError`, and `isLikelyVpnDown` does its own `isApiError` check internally) — the existing `import { ApiError } from '@/api';` line becomes unused and must be removed from both files.

**3. `StreamStatusBanner.tsx`** (already exists, shipped in OC-21's fix rounds) — the always-mounted
strip shown while the one persistent SSE connection is `'reconnecting'`. `StreamClient` doesn't expose
*why* it's reconnecting (no `ApiError`, just a status enum — see `src/stream/StreamClient.ts`'s
`scheduleRetry`, called for both a raw fetch failure and a non-401 bad HTTP status), so the banner
can't reuse `isLikelyVpnDown` (which needs an `Error`) — but the same reasoning applies directly:
*any* reconnect on the `wireguard` profile is overwhelmingly likely tunnel-related, so the banner
swaps its copy when `environment.id === 'wireguard'`, reusing the shared `VPN_DOWN_MESSAGE` constant
so the wording matches what the data screens say:
```tsx
import { Text, View } from 'react-native';

import { useEnvironment } from '@/config/EnvironmentContext';
import { useStreamStatus } from '@/stream/StreamContext';

import { VPN_DOWN_MESSAGE } from './gatewayErrorMessage';

export function StreamStatusBanner() {
  const status = useStreamStatus();
  const { environment } = useEnvironment();
  if (status !== 'reconnecting') return null;
  const vpnDown = environment.id === 'wireguard';
  return (
    <View className="items-center bg-danger px-4 py-1 dark:bg-night-danger">
      <Text className="text-xs uppercase text-white">
        {vpnDown ? VPN_DOWN_MESSAGE : 'Reconectando con el gateway…'}
      </Text>
    </View>
  );
}
```
No `VpnSettingsButton` in the banner — it's a thin, always-mounted top strip; a button there would be
cramped and this app already gives the operator a full-screen actionable version (data screens' first-
load error, or login/TOTP) wherever there's room. This is a deliberate scope line, not an oversight.

## Out of scope

- **iOS "deep link"**: no reliable mechanism exists (researched above); text-only messaging is the
  honest answer for this platform in Phase 1.
- **A dedicated full-screen connectivity gate** (mirroring `RootNavigator`'s auth `Stack.Protected`
  pattern): rejected in favor of extending the existing per-screen `Empty`/banner pattern every screen
  already uses — introducing a second, competing "something's wrong" UI surface (a new blocking
  overlay on top of the per-screen Empty states that already handle this) would fragment the app's
  established error-handling language for no behavioral gain; the existing pattern already surfaces the
  message wherever a screen has no data to show.
- **Background-refetch errors on Status/Players/Logs** (data already loaded, then a later poll/refetch
  fails silently): out of scope for this ticket — §5.4 and the backlog line are specifically about the
  first-load "every request fails" case. Chat already got a background-error banner in OC-21's second
  fix round; the other three screens' identical gap (noted but deliberately deferred during OC-21's own
  review, since it was pre-existing and shared) stays deferred here too — extending it would be a
  second, unrelated change bundled into a connectivity-detection ticket.
- **A mock-gateway "simulate VPN down" scenario**: not needed. The `wireguard` profile
  (`10.77.0.1:19260`) is already unreachable from a normal dev machine not on the VPN — switching the
  environment picker to `wireguard` while developing locally produces a *real* `network_error` with no
  extra tooling, which is exactly what this feature needs to verify live.

## Testing

No test runner in this repo (per `docs/reference/../ops-run` conventions) — verification is
`npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live check: switch the
environment picker to `wireguard` on a dev machine (real network failure, no mock needed), confirm
the login screen, each of the four data screens' first-load state, and the stream-reconnect banner
all show the VPN-specific message; on Android (device or emulator), confirm the button opens the
system VPN settings screen; on web, confirm no button renders and the message alone is shown. Switch
back to `mock` and confirm all of the above reverts to today's generic messaging with no VPN button
anywhere.

import { useEffect, useRef, useState } from 'react';
import type { LiveActivity } from 'expo-widgets';

import { useAuth } from '@/auth/AuthContext';

import { serverStatusActivity, type ServerStatusActivityState } from './ServerStatusActivity';
import { useLifecycleState } from './useLifecycleState';
import { useStatusQuery } from './useStatusQuery';

// Derives the widget's own (deliberately small) content shape from `useStatusQuery()` +
// `useLifecycleState()` — the same two sources `StatusScreen.tsx` itself reads from, so this
// activity can never show something the screen itself disagrees with. Returns `null` only in the
// brief window before the bootstrap `/status` fetch has landed (mirrors `StatusScreen.tsx`'s own
// `query.data === undefined` guard) — `toggle()` below no-ops if pressed before that, which
// matches the existing screen's behavior of not rendering any controls yet either.
function deriveState(
  status: ReturnType<typeof useStatusQuery>['data'],
  lifecycle: ReturnType<typeof useLifecycleState>,
): ServerStatusActivityState | null {
  if (!status || !lifecycle) return null;
  return {
    lifecycleState: lifecycle.state,
    playersOnline: status.players_online,
    // Only 'draining' has a meaningful countdown — `lifecycle.secondsLeft` is itself only
    // populated for that state (see useLifecycleState.ts), with `status.pending_shutdown` as a
    // fallback for the brief window where `live` hasn't landed yet but a derived guess already
    // shows 'draining' from the bootstrap snapshot.
    drainSecondsLeft:
      lifecycle.state === 'draining'
        ? (lifecycle.secondsLeft ?? status.pending_shutdown?.seconds_left ?? null)
        : null,
  };
}

export function useServerStatusLiveActivity(): { active: boolean; toggle: () => void } {
  const query = useStatusQuery();
  const lifecycle = useLifecycleState(query.data);
  const { status: authStatus } = useAuth();
  const [active, setActive] = useState(false);

  // Refs, not state — the running `LiveActivity` instance and the last props sent to it are
  // both write-only outputs of this hook's own effects/toggle(), never something a render needs
  // to read to decide what to show (that's `active`, which IS state).
  const instanceRef = useRef<LiveActivity<ServerStatusActivityState> | null>(null);
  const lastSentRef = useRef<string | null>(null);

  const derived = deriveState(query.data, lifecycle);
  // Stringified once per render for two uses below (the update-effect's dependency and its own
  // redundant-call guard) — cheap relative to a native `.update()` call, and simpler than a
  // hand-rolled shallow-equal over three fields.
  const derivedKey = derived ? JSON.stringify(derived) : null;

  // While active, push every real change in status/lifecycle to the running instance. Compares
  // against `lastSentRef` first so an unrelated re-render with unchanged status data (e.g. the
  // stream's 5s heartbeat re-delivering the same values) doesn't fire a redundant native
  // `.update()` call.
  // `derived` is deliberately omitted from the dependency array below: it's a fresh object every
  // render (deriveState() returns a new literal each call), so depending on it directly would
  // defeat the whole point of `derivedKey` (its JSON serialization) as the real, value-stable
  // dependency — the guard above already reads `derived` itself (not just the key) once the
  // effect actually runs, so this isn't reading a stale closure value.
  useEffect(() => {
    if (!active || !instanceRef.current || !derived || derivedKey === lastSentRef.current) {
      return;
    }
    lastSentRef.current = derivedKey;
    instanceRef.current.update(derived).catch(() => {
      // Best-effort — a failed Live Activity update must not crash the screen that triggered it;
      // the next status change gets another chance, and the toggle itself is unaffected.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, derivedKey]);

  // Ends the activity when the operator logs out — there's no dedicated logout callback registry
  // on AuthContext, and adding one there for a single caller would be more machinery than just
  // watching `status` here (per the brief's own "use your judgment" steer). Also covers the
  // unattended case where `AppLockGate`/an auth error demotes `status` to 'unauthenticated' out
  // from under an active toggle — the activity shouldn't keep showing server internals on a
  // locked-out device.
  useEffect(() => {
    if (authStatus === 'authenticated') return;
    if (!instanceRef.current) return;
    instanceRef.current.end('default').catch(() => {});
    instanceRef.current = null;
    lastSentRef.current = null;
    setActive(false);
  }, [authStatus]);

  // Ends the activity on unmount (e.g. Fast Refresh during development, or this hook's owner
  // screen being torn down) — a Live Activity is a Lock Screen presence outliving the component
  // that started it by design, but leaving one dangling for an unmount this hook itself didn't
  // choose (not a deliberate toggle-off) would be a silent leak from the operator's perspective.
  useEffect(() => {
    return () => {
      instanceRef.current?.end('default').catch(() => {});
      instanceRef.current = null;
    };
  }, []);

  function toggle() {
    if (active) {
      instanceRef.current?.end('default').catch(() => {});
      instanceRef.current = null;
      lastSentRef.current = null;
      setActive(false);
      return;
    }
    // No-op if pressed before the bootstrap fetch lands — mirrors StatusScreen.tsx's own guard
    // (nothing meaningful to show yet, and `start()` requires real initial props).
    if (!derived) return;
    instanceRef.current = serverStatusActivity.start(derived);
    lastSentRef.current = derivedKey;
    setActive(true);
  }

  return { active, toggle };
}

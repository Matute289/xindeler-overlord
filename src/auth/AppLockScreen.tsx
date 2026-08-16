import { useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';

export function AppLockScreen({
  operator,
  onUnlock,
  onLogout,
}: {
  operator: string | null;
  onUnlock: () => void;
  onLogout: () => Promise<void>;
}) {
  const [authenticating, setAuthenticating] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);

  async function attemptUnlock() {
    setAuthenticating(true);
    setFailed(false);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Desbloqueá Overlord',
        cancelLabel: 'Cancelar',
        // Deliberate — design doc's "The lock screen itself" section: on a biometric failure,
        // the OS's own device-passcode entry becomes available. That's the phone's existing
        // lock-screen credential, not a new PIN this app invents; someone who knows it already
        // has full device access regardless of this screen.
        disableDeviceFallback: false,
      });
      if (result.success) {
        onUnlock();
        return;
      }
      setFailed(true);
    } catch {
      // final-review finding, Critical 2: `authenticateAsync` can REJECT (not just resolve
      // `{ success: false }`) — a missing usage description, no host Activity on Android, an
      // invalid option combination. Without this catch, a rejection left `authenticating` stuck
      // `true` forever: the button stayed disabled/spinning and no failure message ever showed,
      // trapping the operator behind this non-dismissable Modal with only "Cerrar sesión" left.
      // Treated identically to a failed attempt — same retry/logout escape hatch either way.
      setFailed(true);
    } finally {
      setAuthenticating(false);
    }
  }

  // Auto-triggers once the app is actually in the FOREGROUND — final-review finding, Important 1.
  // This screen mounts the instant `AppLockGate` sets `locked = true`, which happens in its
  // `AppState` listener on the transition AWAY from `'active'` (backgrounding) — i.e. this
  // component's own mount effect used to fire `authenticateAsync()` WHILE the app was leaving
  // the foreground, the one moment the OS is least likely to actually present a biometric sheet.
  // That produced a spurious `success: false` (or a rejection, see the catch above) the operator
  // would see the instant they actually returned — exactly the extra-friction case the "auto,
  // no extra tap" design was meant to avoid.
  const triggeredRef = useRef(false);
  useEffect(() => {
    function tryTrigger() {
      if (triggeredRef.current || AppState.currentState !== 'active') return;
      triggeredRef.current = true;
      void attemptUnlock();
    }

    const subscription = AppState.addEventListener('change', tryTrigger);
    // Covers the cold-boot-already-active case (this screen mounting while the app is already
    // in the foreground — e.g. a valid persisted session resolving while active): `tryTrigger`
    // also runs once here, via `setTimeout` rather than a direct call, so it executes as a
    // genuinely deferred callback — not synchronously as part of this effect's own body — for
    // the same reason the `AppState.addEventListener` callback above doesn't trip this project's
    // `react-hooks/set-state-in-effect` lint rule (a direct synchronous call here was fix round
    // 1's original mistake, caught at the lint gate rather than shipped).
    const timer = setTimeout(tryTrigger, 0);

    return () => {
      subscription.remove();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    setLogoutFailed(false);
    try {
      await onLogout();
      // On success, `AuthContext`'s `status` flips to `'unauthenticated'`, `shouldShowLock`
      // becomes false, and this component unmounts — no further state update needed here.
    } catch {
      // final-review finding, Important 3: `onLogout()` (→ `AuthContext.logout()`) previously had
      // its rejection silently discarded (`onLogout={() => void logout()}` in AppLockGate). If it
      // throws — e.g. `sessionStorage.clear()` failing — `status` never flips, this non-dismissable
      // Modal never disappears, and the operator was stuck with a dead tap and no explanation.
      setLoggingOut(false);
      setLogoutFailed(true);
    }
  }

  return (
    <Modal visible transparent={false} animationType="none" onRequestClose={() => {}}>
      <View className="flex-1 items-center justify-center gap-6 bg-bg-base px-8 dark:bg-night-bg-base">
        <Text
          className="text-xl text-steel-light dark:text-night-steel-light"
          style={{ fontFamily: fonts.bold }}
        >
          Overlord bloqueado
        </Text>
        {/* Shown deliberately, pre-auth — final-review finding: "who is this locked as" is a
            useful affordance (an operator handing the phone to a teammate, or picking it up
            from a colleague), and is a lower-sensitivity disclosure than anything the lock
            actually protects (server controls, player data). */}
        {operator && (
          <Text
            className="text-sm text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            {operator}
          </Text>
        )}
        {failed && (
          <Text
            className="text-center text-sm text-danger dark:text-night-danger"
            style={{ fontFamily: fonts.regular }}
          >
            No se pudo verificar tu identidad.
          </Text>
        )}
        <Button label="Desbloquear" onPress={() => void attemptUnlock()} loading={authenticating} />
        {logoutFailed && (
          <Text
            className="text-center text-sm text-danger dark:text-night-danger"
            style={{ fontFamily: fonts.regular }}
          >
            No se pudo cerrar sesión. Probá de nuevo.
          </Text>
        )}
        <Pressable
          onPress={() => void handleLogout()}
          accessibilityRole="button"
          disabled={loggingOut}
        >
          <Text
            className="text-center text-sm text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            {loggingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}

import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { isApiError } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useEnvironment } from '@/config/EnvironmentContext';
import { zuulErrorMessage, isLikelyVpnDown } from '@/features/connectivity/zuulErrorMessage';
import { VpnSettingsButton } from '@/features/connectivity/VpnSettingsButton';
import { AuthSplitScreen } from '@/ui/AuthSplitScreen';
import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';
import { TextField } from '@/ui/TextField';

// OC-77 round 2 / ZG-73 (final contract, 2026-08-29): shown inline on THIS screen — not a
// separate route — because there is nothing left to do here. Unlike round 1 of this feature
// (reverted for a security flaw), the gateway never hands back a secret/QR from `/login` itself;
// the operator's only path forward is an admin-sent invite email with its own standalone link.
const ENROLLMENT_PENDING_MESSAGE =
  'Este operador todavía no completó el registro de verificación en dos pasos. Revisá tu email por el link de invitación de un administrador (o pedile que te lo reenvíe).';

// This app's other screens are data-dense (tables, forms) where a busy illustrated background
// would fight legibility — this screen and totp.tsx (the only other low-density (auth) screen)
// share the same dramatic art instead, via `AuthSplitScreen`. Deliberately not using the shared
// `Screen` wrapper (its own doc comment already anticipated this: "Revisit if Screen is ever used
// outside that nav shell — e.g. a future full-bleed login screen"): `Screen` paints an opaque flat
// surface everywhere, which would hide the art entirely on 'phone' — `AuthSplitScreen` is this
// screen's own equivalent, art-aware on 'phone' and two-panel on 'wide' (OC-83).
export default function LoginScreen() {
  const { beginLogin, checkLoginStatus } = useAuth();
  const { environment } = useEnvironment();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [enrollmentPending, setEnrollmentPending] = useState(false);

  // final-review Minor: bounds how long an abandoned login attempt's credentials sit in
  // AuthContext's in-memory ref (e.g. the operator typed a code, tapped "Volver", and never
  // returned) — clearing pending state the moment this screen is reached again is a natural,
  // no-extra-UI way to do it, distinct from the environment-switch clear above.
  useEffect(() => {
    beginLogin('', '');
  }, [beginLogin]);

  // OC-77 round 2 / ZG-73 (final contract): checkLoginStatus makes the one real `/login` call
  // (with an empty TOTP code) needed to tell an operator with no confirmed enrollment apart from
  // everyone else — see its own doc comment in AuthContext for the full outcome table.
  async function handleSubmit() {
    setError(null);
    setEnrollmentPending(false);
    setChecking(true);
    try {
      const outcome = await checkLoginStatus(username, password);
      if (outcome === 'enrollment_pending') {
        setEnrollmentPending(true);
      } else {
        router.push('/totp');
      }
    } catch (err) {
      setError(isApiError(err) ? err : new Error('No se pudo conectar con Zuul'));
    } finally {
      setChecking(false);
    }
  }

  return (
    <AuthSplitScreen>
      {/* Unconditionally the light-on-dark token, not the usual `text-steel-light
          dark:text-night-steel-light` split — `AuthSplitScreen` keeps this screen on a fixed
          dark surface (art on 'phone', a solid dark panel on 'wide') in both system light and
          dark mode, so the text needs the same fixed light color either way. */}
      <Text className="text-2xl text-night-steel-light" style={{ fontFamily: fonts.bold }}>
        Overlord
      </Text>
      <View className="w-full gap-4">
        <TextField
          label="Usuario"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          forceNight
        />
        <TextField
          label="Contraseña"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          forceNight
        />
      </View>
      {enrollmentPending && (
        <Text className="text-center text-sm text-night-steel-light">
          {ENROLLMENT_PENDING_MESSAGE}
        </Text>
      )}
      {error && (
        <>
          <Text className="text-center text-sm text-night-danger">
            {zuulErrorMessage(environment.id, error)}
          </Text>
          {isLikelyVpnDown(environment.id, error) && <VpnSettingsButton />}
        </>
      )}
      <Button
        label="Ingresar"
        onPress={handleSubmit}
        loading={checking}
        disabled={username.length === 0 || password.length === 0}
        forceNight
      />
    </AuthSplitScreen>
  );
}

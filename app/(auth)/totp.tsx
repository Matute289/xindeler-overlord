import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { isApiError } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useEnvironment } from '@/config/EnvironmentContext';
import { zuulErrorMessage, isLikelyVpnDown } from '@/features/connectivity/zuulErrorMessage';
import { VpnSettingsButton } from '@/features/connectivity/VpnSettingsButton';
import { AuthSplitScreen } from '@/ui/AuthSplitScreen';
import { Button } from '@/ui/Button';
import { Pressable } from '@/ui/Pressable';
import { fonts } from '@/ui/theme';
import { TextField } from '@/ui/TextField';

export default function TotpScreen() {
  const { hasPendingLogin, completeLogin } = useAuth();
  const { environment } = useEnvironment();
  const [code, setCode] = useState('');
  // ZG-61: an operator's own xindeler-auth account may separately have 2FA enabled — entirely
  // unrelated to `code` above (that's the operator's Zuul enrollment). The gateway's login
  // response never reveals whether a given account needs this (anti-enumeration, matching
  // every other route in this app), so the client can't decide this automatically — the
  // operator opts in themselves via this toggle, which they'd only ever know to do because
  // it's their own account.
  const [useAuthTotp, setUseAuthTotp] = useState(false);
  const [authCode, setAuthCode] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  if (!hasPendingLogin) {
    return <Redirect href="/login" />;
  }

  const authCodeComplete = !useAuthTotp || authCode.length === 6;

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      await completeLogin(code, useAuthTotp ? authCode : undefined);
      // No manual navigation on success — AuthContext's status flip to 'authenticated'
      // is what Stack.Protected reacts to; the app switches to (tabs) on its own.
    } catch (err) {
      setError(isApiError(err) ? err : new Error('No se pudo conectar con Zuul'));
      setLoading(false);
    }
  }

  return (
    <AuthSplitScreen>
      {/* Unconditionally the light-on-dark token — same reasoning as login.tsx's own title. */}
      <Text className="text-2xl text-night-steel-light" style={{ fontFamily: fonts.bold }}>
        Código de verificación
      </Text>
      <View className="w-full gap-6">
        <TextField
          label="Código de Verificación Overlord"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoCapitalize="none"
          maxLength={6}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          forceNight
        />
        <View className="gap-4">
          <Pressable
            onPress={() => setUseAuthTotp((current) => !current)}
            accessibilityRole="switch"
            accessibilityState={{ checked: useAuthTotp }}
            accessibilityLabel="Código Verificación Xindeler"
            className="w-full flex-row items-center justify-between"
          >
            <Text
              className={useAuthTotp ? 'text-night-steel-light' : 'text-night-steel-muted'}
              style={{ fontFamily: fonts.regular }}
            >
              Código Verificación Xindeler
            </Text>
            <View
              className={`h-7 w-12 justify-center rounded-full px-0.5 ${
                useAuthTotp ? 'bg-night-accent-cyan' : 'bg-night-steel-dark'
              }`}
            >
              <View
                className={`h-6 w-6 rounded-full bg-night-bg-surface ${useAuthTotp ? 'ml-5' : 'ml-0'}`}
              />
            </View>
          </Pressable>
          {useAuthTotp && (
            <TextField
              label="Código de tu cuenta Xindeler"
              value={authCode}
              onChangeText={setAuthCode}
              keyboardType="number-pad"
              autoCapitalize="none"
              maxLength={6}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              forceNight
            />
          )}
        </View>
      </View>
      {error && (
        <>
          <Text className="text-center text-sm text-night-danger">
            {zuulErrorMessage(environment.id, error)}
          </Text>
          {isLikelyVpnDown(environment.id, error) && <VpnSettingsButton />}
        </>
      )}
      <Button
        label="Confirmar"
        onPress={handleSubmit}
        loading={loading}
        disabled={code.length !== 6 || !authCodeComplete}
        forceNight
      />
      <Pressable onPress={() => router.back()}>
        <Text className="text-sm text-night-steel-muted" style={{ fontFamily: fonts.regular }}>
          Volver
        </Text>
      </Pressable>
    </AuthSplitScreen>
  );
}

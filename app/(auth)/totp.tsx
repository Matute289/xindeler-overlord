import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';

import { isApiError } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useEnvironment } from '@/config/EnvironmentContext';
import { gatewayErrorMessage, isLikelyVpnDown } from '@/features/connectivity/gatewayErrorMessage';
import { VpnSettingsButton } from '@/features/connectivity/VpnSettingsButton';
import { Button } from '@/ui/Button';
import { Pressable } from '@/ui/Pressable';
import { fonts } from '@/ui/theme';
import { Screen } from '@/ui/Screen';
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
      setError(isApiError(err) ? err : new Error('No se pudo conectar con el gateway'));
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <View className="flex-1 items-center justify-center gap-6 px-8">
          <Text
            className="text-2xl text-steel-light dark:text-night-steel-light"
            style={{ fontFamily: fonts.bold }}
          >
            Código de verificación
          </Text>
          <View className="w-full gap-4">
            <TextField
              label="Código de Verificación Overlord"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoCapitalize="none"
              maxLength={6}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
            />
            <Pressable
              onPress={() => setUseAuthTotp((current) => !current)}
              accessibilityRole="switch"
              accessibilityState={{ checked: useAuthTotp }}
              className={`self-start rounded-full border px-3 py-1 ${
                useAuthTotp
                  ? 'border-accent-cyan dark:border-night-accent-cyan'
                  : 'border-steel-dark dark:border-night-steel-dark'
              }`}
            >
              <Text
                className={
                  useAuthTotp
                    ? 'text-accent-cyan dark:text-night-accent-cyan'
                    : 'text-steel-muted dark:text-night-steel-muted'
                }
                style={{ fontFamily: fonts.regular }}
              >
                Código Verificación Xindeler
              </Text>
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
              />
            )}
          </View>
          {error && (
            <>
              <Text className="text-center text-sm text-danger dark:text-night-danger">
                {gatewayErrorMessage(environment.id, error)}
              </Text>
              {isLikelyVpnDown(environment.id, error) && <VpnSettingsButton />}
            </>
          )}
          <Button
            label="Confirmar"
            onPress={handleSubmit}
            loading={loading}
            disabled={code.length !== 6 || !authCodeComplete}
          />
          <Pressable onPress={() => router.back()}>
            <Text
              className="text-sm text-steel-muted dark:text-night-steel-muted"
              style={{ fontFamily: fonts.regular }}
            >
              Volver
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

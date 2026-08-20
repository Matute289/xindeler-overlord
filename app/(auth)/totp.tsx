import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';

import { isApiError } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useEnvironment } from '@/config/EnvironmentContext';
import { gatewayErrorMessage, isLikelyVpnDown } from '@/features/connectivity/gatewayErrorMessage';
import { VpnSettingsButton } from '@/features/connectivity/VpnSettingsButton';
import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';

export default function TotpScreen() {
  const { hasPendingLogin, completeLogin } = useAuth();
  const { environment } = useEnvironment();
  const [code, setCode] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  if (!hasPendingLogin) {
    return <Redirect href="/login" />;
  }

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      await completeLogin(code);
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
          <View className="w-full">
            <TextField
              label="Código de 6 dígitos"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoCapitalize="none"
              maxLength={6}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
            />
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
            disabled={code.length !== 6}
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

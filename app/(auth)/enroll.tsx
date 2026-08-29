import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isApiError } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useEnvironment } from '@/config/EnvironmentContext';
import { zuulErrorMessage, isLikelyVpnDown } from '@/features/connectivity/zuulErrorMessage';
import { VpnSettingsButton } from '@/features/connectivity/VpnSettingsButton';
import { AuthBackdrop } from '@/ui/AuthBackdrop';
import { Button } from '@/ui/Button';
import { Pressable } from '@/ui/Pressable';
import { fonts } from '@/ui/theme';
import { TextField } from '@/ui/TextField';

// OC-77 / ZG-73 (proposed to xindeler-zuul, not yet shipped): reached only from login.tsx's own
// checkLoginStatus() call, when the gateway reports the operator attempting to log in has no
// confirmed TOTP enrollment yet. Renders the QR/secret `pendingEnrollment` carries and lets the
// operator confirm the first code their authenticator app generates — mirrors what Matías's own
// `enroll-operator` CLI flow (ZG-38) already does over SSH, just reachable from the app itself
// for the first time. Same dark/full-bleed backdrop as login.tsx/totp.tsx — this is a peer of
// those two, not a data-dense screen.
export default function EnrollScreen() {
  const { hasPendingLogin, pendingEnrollment, confirmEnrollment } = useAuth();
  const { environment } = useEnvironment();
  const [code, setCode] = useState('');
  // ZG-61: same second, unrelated xindeler-auth-account TOTP code login.tsx's own /totp screen
  // supports — `enroll_confirm` re-authenticates with username+password exactly like `login`
  // does, so an operator whose xindeler-auth account already has its own 2FA needs this here too.
  const [useAuthTotp, setUseAuthTotp] = useState(false);
  const [authCode, setAuthCode] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  if (!hasPendingLogin || !pendingEnrollment) {
    return <Redirect href="/login" />;
  }

  const authCodeComplete = !useAuthTotp || authCode.length === 6;

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      await confirmEnrollment(code, useAuthTotp ? authCode : undefined);
      // Matías's own spec (step 3): confirming enrollment never logs the operator in — it always
      // returns them to a normal login, now completed with their just-confirmed code.
      router.replace('/login');
    } catch (err) {
      setError(isApiError(err) ? err : new Error('No se pudo conectar con Zuul'));
      setLoading(false);
    }
  }

  return (
    <View className="flex-1">
      <AuthBackdrop />
      <SafeAreaView edges={['bottom', 'left', 'right']} className="flex-1">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          className="flex-1"
        >
          <View className="flex-1 items-center justify-center gap-6 px-8">
            <Text className="text-2xl text-night-steel-light" style={{ fontFamily: fonts.bold }}>
              Activar verificación en dos pasos
            </Text>
            <Text className="text-center text-sm text-night-steel-muted">
              Escaneá este código con tu app de autenticación (Google Authenticator, Authy, etc.) y
              después ingresá el código que te muestre.
            </Text>
            <Image
              source={{ uri: `data:image/png;base64,${pendingEnrollment.qr_png_base64}` }}
              style={{ width: 200, height: 200, borderRadius: 8 }}
              resizeMode="contain"
            />
            <View className="w-full gap-1">
              <Text className="text-center text-xs text-night-steel-muted">
                O ingresalo manualmente:
              </Text>
              <Text
                selectable
                className="text-center text-sm text-night-steel-light"
                style={{ fontFamily: fonts.regular }}
              >
                {pendingEnrollment.secret_base32}
              </Text>
            </View>
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
            <Pressable onPress={() => router.replace('/login')}>
              <Text
                className="text-sm text-night-steel-muted"
                style={{ fontFamily: fonts.regular }}
              >
                Volver
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

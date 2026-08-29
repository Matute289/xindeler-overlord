import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isApiError } from '@/api';
import { useApi } from '@/api/ApiContext';
import { useEnvironment } from '@/config/EnvironmentContext';
import { zuulErrorMessage, isLikelyVpnDown } from '@/features/connectivity/zuulErrorMessage';
import { VpnSettingsButton } from '@/features/connectivity/VpnSettingsButton';
import { AuthBackdrop } from '@/ui/AuthBackdrop';
import { Button } from '@/ui/Button';
import { Empty } from '@/ui/Empty';
import { Pressable } from '@/ui/Pressable';
import { fonts } from '@/ui/theme';
import { TextField } from '@/ui/TextField';

// OC-77 round 2 / ZG-73 (final contract, confirmed 2026-08-29): a fully standalone page — reached
// only via an admin-sent invite email's own link (`https://zuul.xindeler.com/enroll?token=...`),
// completely independent of the normal login flow's state (no `AuthContext` involvement at all
// until the very end, when a successful confirm sends the operator back to a normal `/login`).
// Round 1 of this feature (reverted the same day it shipped) reached this screen FROM the login
// flow with a secret already in hand — that shape reintroduced an account-takeover attack ZG-38
// had already rejected; this round never lets `/login` hand back a secret at all.
export default function EnrollScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const api = useApi();
  const { environment } = useEnvironment();

  const beginQuery = useQuery({
    queryKey: ['enrollBegin', token],
    queryFn: () => api.auth.enrollBegin(token as string),
    enabled: typeof token === 'string' && token.length > 0,
    retry: false,
  });

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // ZG-61: same second, unrelated xindeler-auth-account TOTP code the normal `/totp` screen
  // supports — `enroll/confirm` re-authenticates with username+password exactly like `/login`
  // does, so an operator whose xindeler-auth account already has its own 2FA needs this here too.
  const [useAuthTotp, setUseAuthTotp] = useState(false);
  const [authCode, setAuthCode] = useState('');
  const [confirmError, setConfirmError] = useState<Error | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (typeof token !== 'string' || token.length === 0) {
    return <Empty title="Registro" message="Este link de invitación no es válido." />;
  }

  const authCodeComplete = !useAuthTotp || authCode.length === 6;

  async function handleConfirm() {
    setConfirmError(null);
    setConfirming(true);
    try {
      await api.auth.enrollConfirm(username, password, code, useAuthTotp ? authCode : undefined);
      // Matías's own spec: confirming enrollment never logs the operator in — it always returns
      // them to a normal login, now completed with their just-confirmed code.
      router.replace('/login');
    } catch (err) {
      setConfirmError(isApiError(err) ? err : new Error('No se pudo conectar con Zuul'));
      setConfirming(false);
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

            {beginQuery.isPending && (
              <Text className="text-center text-sm text-night-steel-muted">Cargando…</Text>
            )}

            {beginQuery.isError && (
              <>
                <Text className="text-center text-sm text-night-danger">
                  {isApiError(beginQuery.error)
                    ? zuulErrorMessage(environment.id, beginQuery.error)
                    : 'Este link de invitación no es válido o ya expiró. Pedile a un administrador que te reenvíe la invitación.'}
                </Text>
                {isApiError(beginQuery.error) &&
                  isLikelyVpnDown(environment.id, beginQuery.error) && <VpnSettingsButton />}
              </>
            )}

            {beginQuery.data && (
              <>
                <Text className="text-center text-sm text-night-steel-muted">
                  Escaneá este código con tu app de autenticación (Google Authenticator, Authy,
                  etc.), después completá tu usuario, contraseña, y el código que te muestre.
                </Text>
                <Image
                  source={{ uri: `data:image/png;base64,${beginQuery.data.qr_png_base64}` }}
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
                    {beginQuery.data.secret_base32}
                  </Text>
                </View>
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
                        className={
                          useAuthTotp ? 'text-night-steel-light' : 'text-night-steel-muted'
                        }
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
                {confirmError && (
                  <>
                    <Text className="text-center text-sm text-night-danger">
                      {zuulErrorMessage(environment.id, confirmError)}
                    </Text>
                    {isLikelyVpnDown(environment.id, confirmError) && <VpnSettingsButton />}
                  </>
                )}
                <Button
                  label="Confirmar"
                  onPress={handleConfirm}
                  loading={confirming}
                  disabled={
                    username.length === 0 ||
                    password.length === 0 ||
                    code.length !== 6 ||
                    !authCodeComplete
                  }
                  forceNight
                />
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

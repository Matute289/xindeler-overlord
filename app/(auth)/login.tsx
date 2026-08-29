import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthContext';
import { AuthBackdrop } from '@/ui/AuthBackdrop';
import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';
import { TextField } from '@/ui/TextField';

// This app's other screens are data-dense (tables, forms) where a busy illustrated background
// would fight legibility — this screen and totp.tsx (the only other low-density (auth) screen)
// share the same dramatic backdrop instead. Deliberately not using the shared `Screen` wrapper
// (its own doc comment already anticipated this: "Revisit if Screen is ever used outside that
// nav shell — e.g. a future full-bleed login screen"): `Screen` paints an opaque flat surface,
// which would hide `AuthBackdrop`'s art. This screen's own content renders transparent on top of
// it instead.
export default function LoginScreen() {
  const { beginLogin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // final-review Minor: bounds how long an abandoned login attempt's credentials sit in
  // AuthContext's in-memory ref (e.g. the operator typed a code, tapped "Volver", and never
  // returned) — clearing pending state the moment this screen is reached again is a natural,
  // no-extra-UI way to do it, distinct from the environment-switch clear above.
  useEffect(() => {
    beginLogin('', '');
  }, [beginLogin]);

  function handleSubmit() {
    beginLogin(username, password);
    router.push('/totp');
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
            {/* Unconditionally the light-on-dark token, not the usual `text-steel-light
                dark:text-night-steel-light` split — this screen's backdrop is the dark art
                image year-round, in both system light and dark mode, so the text needs the
                same fixed light color either way. */}
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
            <Button
              label="Ingresar"
              onPress={handleSubmit}
              disabled={username.length === 0 || password.length === 0}
              forceNight
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

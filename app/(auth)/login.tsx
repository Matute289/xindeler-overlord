import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';

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
            />
            <TextField
              label="Contraseña"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
            />
          </View>
          <Button
            label="Ingresar"
            onPress={handleSubmit}
            disabled={username.length === 0 || password.length === 0}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

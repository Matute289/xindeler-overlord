import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';

import { ApiError } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';

export default function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      const { challengeId } = await login(username, password);
      router.push({ pathname: '/totp', params: { challengeId } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el gateway');
    } finally {
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
          {error && (
            <Text className="text-center text-sm text-danger dark:text-night-danger">{error}</Text>
          )}
          <Button
            label="Ingresar"
            onPress={handleSubmit}
            loading={loading}
            disabled={username.length === 0 || password.length === 0}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ApiError } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/ui/Button';
import { fonts } from '@/ui/theme';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';

export default function TotpScreen() {
  const { challengeId } = useLocalSearchParams<{ challengeId: string }>();
  const { totp } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      await totp(challengeId, code);
      // No manual navigation on success — AuthContext's status flip to 'authenticated'
      // is what Stack.Protected reacts to; the app switches to (tabs) on its own.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el gateway');
      setLoading(false);
    }
  }

  return (
    <Screen>
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
          />
        </View>
        {error && (
          <Text className="text-center text-sm text-accent-cyan dark:text-night-accent-cyan">
            {error}
          </Text>
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
    </Screen>
  );
}

import { useState } from 'react';
import { Text, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import { ActionError } from '@/features/connectivity/ActionError';
import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { Button } from '@/ui/Button';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { TextField } from '@/ui/TextField';
import { fonts } from '@/ui/theme';

const SUCCESS_MESSAGE_MS = 3000;

export function PlayerAccountsScreen() {
  const api = useApi();
  const [username, setUsername] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const unlockAction = useDestructiveAction<void>((code, idempotencyKey) =>
    api.write.unlockPlayer2fa(username.trim(), code, idempotencyKey),
  );

  async function handleConfirm() {
    setSuccessMessage(null);
    setConfirming(false);
    const target = username.trim();
    const result = await unlockAction.run();
    // `run()` resolves `T | null` — `T` is `void` here, so a successful call resolves
    // `undefined`, and only a failed/cancelled call resolves the literal `null`. Checking
    // `!== null` (not `!== undefined`) is what actually distinguishes the two at runtime.
    if (result !== null) {
      setSuccessMessage(`Listo — 2FA desbloqueado para ${target}.`);
      setTimeout(() => setSuccessMessage(null), SUCCESS_MESSAGE_MS);
      setUsername('');
    }
  }

  return (
    <View className="gap-4 px-6 pt-6">
      <Text
        className="text-xl text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.bold }}
      >
        Cuentas de jugador
      </Text>
      <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
        Desbloqueá la cuenta de un jugador que se quedó afuera por códigos de 2FA incorrectos.
      </Text>
      <TextField
        label="Nombre de usuario"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button
        label="Desbloquear 2FA"
        onPress={() => setConfirming(true)}
        loading={unlockAction.pending}
        disabled={username.trim().length === 0}
      />
      {unlockAction.error && <ActionError error={unlockAction.error} />}
      {successMessage && (
        <Text className="text-sm text-accent-cyan dark:text-night-accent-cyan">
          {successMessage}
        </Text>
      )}
      <ConfirmByTypingSheet
        visible={confirming}
        word="UNLOCK"
        description={`Esto va a desbloquear la cuenta de "${username.trim()}" — no hay confirmación previa del jugador.`}
        onConfirm={handleConfirm}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}

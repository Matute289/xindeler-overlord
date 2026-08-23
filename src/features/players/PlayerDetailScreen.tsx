import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import type { PlayerFlag } from '@/api/schemas';
import { ActionError } from '@/features/connectivity/ActionError';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { Button } from '@/ui/Button';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { Empty } from '@/ui/Empty';
import { TextField } from '@/ui/TextField';
import { fonts } from '@/ui/theme';

import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { usePlayerDetailQuery } from './usePlayerDetailQuery';

const STATE_LABELS: Record<string, string> = {
  active: 'Activo',
  blocked: 'Bloqueado',
  banned: 'Baneado',
  deactivated: 'Desactivado',
};

function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

function flagLabel(flag: PlayerFlag): string {
  const colorLabel = flag.color === 'red' ? 'Rojo' : 'Amarillo';
  const revoked = flag.revoked_at !== null ? ' (revocado)' : '';
  return `${colorLabel} — ${flag.reason}${revoked}`;
}

type ConfirmAction = 'flag_yellow' | 'flag_red' | 'kick' | 'ban' | 'unban';

const CONFIRM_WORDS: Record<ConfirmAction, string> = {
  flag_yellow: 'FLAG',
  flag_red: 'FLAG',
  kick: 'KICK',
  ban: 'BAN',
  unban: 'UNBAN',
};

export function PlayerDetailScreen({ reference }: { reference: string }) {
  const api = useApi();
  const query = usePlayerDetailQuery(reference);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [reason, setReason] = useState('');

  const flagAction = useDestructiveAction((idempotencyKey) =>
    api.write.issuePlayerFlag(
      reference,
      { color: confirmAction === 'flag_red' ? 'red' : 'yellow', reason },
      idempotencyKey,
    ),
  );
  const kickAction = useDestructiveAction((idempotencyKey) =>
    api.write.kickPlayer(reference, reason || undefined, idempotencyKey),
  );
  const banAction = useDestructiveAction((idempotencyKey) =>
    api.write.banPlayer(reference, { reason }, idempotencyKey),
  );
  const unbanAction = useDestructiveAction((idempotencyKey) =>
    api.write.unbanPlayer(reference, { reason }, idempotencyKey),
  );

  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Jugador" error={query.error} />;
    }
    return <Empty title="Jugador" message="Cargando…" />;
  }

  const { moderation } = query.data;

  if (moderation === null) {
    return <Empty title="Jugador" message="No se pudo cargar la información de esta cuenta." />;
  }

  const safeModeration = moderation;

  function handleSheetConfirm() {
    setConfirmAction(null);
    if (confirmAction === 'flag_yellow' || confirmAction === 'flag_red') {
      flagAction.run().then(() => {
        setReason('');
        query.refetch();
      });
    } else if (confirmAction === 'kick') {
      kickAction.run().then(() => setReason(''));
    } else if (confirmAction === 'ban') {
      banAction.run().then(() => {
        setReason('');
        query.refetch();
      });
    } else if (confirmAction === 'unban') {
      unbanAction.run().then(() => {
        setReason('');
        query.refetch();
      });
    }
  }

  function confirmDescription(): string {
    switch (confirmAction) {
      case 'flag_yellow':
        return `Se emitirá un flag amarillo a ${safeModeration.display_username}.`;
      case 'flag_red':
        return `Se emitirá un flag rojo a ${safeModeration.display_username}.`;
      case 'kick':
        return `Se desconectará a ${safeModeration.display_username} si está conectado.`;
      case 'ban':
        return `Se baneará la cuenta de ${safeModeration.display_username}.`;
      case 'unban':
        return `Se levantará el ban y se revocarán los flags activos de ${safeModeration.display_username}.`;
      default:
        return '';
    }
  }

  return (
    <ScrollView className="flex-1 px-6 pt-8" contentContainerClassName="gap-4 pb-12">
      <Text
        className="text-xl text-steel-light dark:text-night-steel-light"
        style={{ fontFamily: fonts.bold }}
      >
        {safeModeration.display_username}
      </Text>
      <Text className="text-sm text-steel-muted dark:text-night-steel-muted">
        {`Estado: ${stateLabel(safeModeration.account_state)}`}
      </Text>

      {safeModeration.flags.length > 0 && (
        <View className="gap-2">
          <Text
            className="text-sm text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.semibold }}
          >
            Flags
          </Text>
          {safeModeration.flags.map((flag) => (
            <Text key={flag.id} className="text-sm text-steel-light dark:text-night-steel-light">
              {flagLabel(flag)}
            </Text>
          ))}
        </View>
      )}

      <TextField label="Razón" value={reason} onChangeText={setReason} autoCapitalize="none" />

      <View className="gap-3">
        <Button
          label="Emitir flag amarillo"
          onPress={() => setConfirmAction('flag_yellow')}
          loading={flagAction.pending}
          disabled={reason.trim().length === 0}
        />
        <Button
          label="Emitir flag rojo"
          onPress={() => setConfirmAction('flag_red')}
          loading={flagAction.pending}
          disabled={reason.trim().length === 0}
        />
        {flagAction.error && <ActionError error={flagAction.error} />}

        <Button
          label="Kick"
          onPress={() => setConfirmAction('kick')}
          loading={kickAction.pending}
        />
        {kickAction.error && <ActionError error={kickAction.error} />}

        <Button
          label="Ban"
          onPress={() => setConfirmAction('ban')}
          loading={banAction.pending}
          disabled={reason.trim().length === 0}
        />
        {banAction.error && <ActionError error={banAction.error} />}

        <Button
          label="Unban"
          onPress={() => setConfirmAction('unban')}
          loading={unbanAction.pending}
          disabled={reason.trim().length === 0}
        />
        {unbanAction.error && <ActionError error={unbanAction.error} />}
      </View>

      <ConfirmByTypingSheet
        visible={confirmAction !== null}
        word={confirmAction ? CONFIRM_WORDS[confirmAction] : ''}
        description={confirmDescription()}
        onConfirm={handleSheetConfirm}
        onCancel={() => setConfirmAction(null)}
      />
    </ScrollView>
  );
}

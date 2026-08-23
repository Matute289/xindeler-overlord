import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import type { CharacterSummary, PlayerFlag } from '@/api/schemas';
import { ActionError } from '@/features/connectivity/ActionError';
import { GatewayErrorEmpty } from '@/features/connectivity/GatewayErrorEmpty';
import { Button } from '@/ui/Button';
import { ConfirmByTypingSheet } from '@/ui/ConfirmByTypingSheet';
import { Empty } from '@/ui/Empty';
import { Pressable } from '@/ui/Pressable';
import { TextField } from '@/ui/TextField';
import { fonts, useTheme } from '@/ui/theme';

import { useDestructiveAction } from '@/features/status/useDestructiveAction';
import { usePlayerDetailQuery } from './usePlayerDetailQuery';

// EXPECTED SHAPE, NOT CONFIRMED against a real backend — see the design doc's ban-by-character
// section. `CharacterSummarySchema` itself stays exactly as the confirmed contract defines it;
// this is a local, mock-only extension so this screen can render suspension state without
// widening the shared schema to include a field only the mock currently sends.
type CharacterWithSuspension = CharacterSummary & { suspended?: boolean };

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

type ConfirmAction =
  | 'flag_yellow'
  | 'flag_red'
  | 'kick'
  | 'ban'
  | 'unban'
  | 'suspend_character'
  | 'unsuspend_character';

const CONFIRM_WORDS: Record<ConfirmAction, string> = {
  flag_yellow: 'FLAG',
  flag_red: 'FLAG',
  kick: 'KICK',
  ban: 'BAN',
  unban: 'UNBAN',
  suspend_character: 'SUSPEND',
  unsuspend_character: 'UNSUSPEND',
};

function CompactCharacterButton({
  character,
  onPress,
  loading = false,
  disabled = false,
}: {
  character: CharacterWithSuspension;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;
  const label = character.suspended === true ? 'Levantar suspensión' : 'Suspender';

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      className={`rounded-full bg-accent-cyan px-3 py-1.5 dark:bg-night-accent-cyan ${isDisabled ? 'opacity-50' : ''}`}
    >
      {loading ? (
        <ActivityIndicator color={colors.background} />
      ) : (
        <Text
          className="text-sm text-bg-base dark:text-night-bg-base"
          style={{ fontFamily: fonts.semibold }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function PlayerDetailScreen({ reference }: { reference: string }) {
  const api = useApi();
  const query = usePlayerDetailQuery(reference);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [reason, setReason] = useState('');
  const [banEmail, setBanEmail] = useState(false);
  const [targetCharacter, setTargetCharacter] = useState<CharacterWithSuspension | null>(null);

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
    api.write.banPlayer(reference, { reason, ban_email: banEmail }, idempotencyKey),
  );
  const unbanAction = useDestructiveAction((idempotencyKey) =>
    api.write.unbanPlayer(reference, { reason }, idempotencyKey),
  );
  const suspendCharacterAction = useDestructiveAction((idempotencyKey) =>
    targetCharacter
      ? api.write.suspendCharacter(reference, targetCharacter.character_id, reason, idempotencyKey)
      : Promise.reject(new Error('no target character')),
  );
  const unsuspendCharacterAction = useDestructiveAction((idempotencyKey) =>
    targetCharacter
      ? api.write.unsuspendCharacter(reference, targetCharacter.character_id, idempotencyKey)
      : Promise.reject(new Error('no target character')),
  );

  if (query.data === undefined) {
    if (query.error) {
      return <GatewayErrorEmpty title="Jugador" error={query.error} />;
    }
    return <Empty title="Jugador" message="Cargando…" />;
  }

  const { moderation, characters } = query.data;

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
        setBanEmail(false);
        query.refetch();
      });
    } else if (confirmAction === 'unban') {
      unbanAction.run().then(() => {
        setReason('');
        query.refetch();
      });
    } else if (confirmAction === 'suspend_character') {
      suspendCharacterAction.run().then(() => {
        setReason('');
        setTargetCharacter(null);
        query.refetch();
      });
    } else if (confirmAction === 'unsuspend_character') {
      unsuspendCharacterAction.run().then(() => {
        setTargetCharacter(null);
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
        return banEmail && safeModeration.email !== null
          ? `Se baneará la cuenta de ${safeModeration.display_username} y también su email (${safeModeration.email}).`
          : `Se baneará la cuenta de ${safeModeration.display_username}.`;
      case 'unban':
        return `Se levantará el ban y se revocarán los flags activos de ${safeModeration.display_username}.`;
      case 'suspend_character':
        return `Se suspenderá al personaje ${targetCharacter?.name ?? ''}.`;
      case 'unsuspend_character':
        return `Se levantará la suspensión del personaje ${targetCharacter?.name ?? ''}.`;
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
        <Pressable
          onPress={() => setBanEmail((current) => !current)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: banEmail }}
          className="flex-row items-center gap-2"
        >
          <View
            className={`h-5 w-5 items-center justify-center rounded border ${
              banEmail
                ? 'border-accent-cyan bg-accent-cyan dark:border-night-accent-cyan dark:bg-night-accent-cyan'
                : 'border-steel-dark dark:border-night-steel-dark'
            }`}
          >
            {banEmail && <Text className="text-xs text-bg-base dark:text-night-bg-base">✓</Text>}
          </View>
          <Text className="text-sm text-steel-light dark:text-night-steel-light">
            También banear el email asociado
          </Text>
        </Pressable>
        {banEmail && safeModeration.email !== null && (
          <Text className="pl-7 text-xs text-steel-muted dark:text-night-steel-muted">
            {`también banear ${safeModeration.email}`}
          </Text>
        )}
        {banAction.error && <ActionError error={banAction.error} />}

        <Button
          label="Unban"
          onPress={() => setConfirmAction('unban')}
          loading={unbanAction.pending}
          disabled={reason.trim().length === 0}
        />
        {unbanAction.error && <ActionError error={unbanAction.error} />}
      </View>

      {characters !== null && characters.length > 0 && (
        <View className="gap-2">
          <Text
            className="text-sm text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.semibold }}
          >
            Personajes
          </Text>
          {(characters as CharacterWithSuspension[]).map((character) => (
            <View
              key={character.character_id}
              className="flex-row items-center justify-between border-b border-steel-dark py-2 dark:border-night-steel-dark"
            >
              <View>
                <Text className="text-steel-light dark:text-night-steel-light">
                  {`${character.name} — Nv. ${character.level} ${character.class}`}
                </Text>
                {character.suspended === true && (
                  <Text className="text-xs text-danger dark:text-night-danger">Suspendido</Text>
                )}
              </View>
              <CompactCharacterButton
                character={character}
                onPress={() => {
                  setTargetCharacter(character);
                  setConfirmAction(
                    character.suspended === true ? 'unsuspend_character' : 'suspend_character',
                  );
                }}
                loading={
                  (character.suspended === true
                    ? unsuspendCharacterAction.pending
                    : suspendCharacterAction.pending) &&
                  targetCharacter?.character_id === character.character_id
                }
                disabled={character.suspended !== true && reason.trim().length === 0}
              />
            </View>
          ))}
        </View>
      )}
      {suspendCharacterAction.error && <ActionError error={suspendCharacterAction.error} />}
      {unsuspendCharacterAction.error && <ActionError error={unsuspendCharacterAction.error} />}

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

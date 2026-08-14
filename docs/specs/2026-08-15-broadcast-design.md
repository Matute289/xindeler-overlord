# Broadcast a message to players (OC-27) design

## What ships

Backlog: *"With a character counter and a preview of what players will see."* Contract §4:
`POST /api/v1/broadcast — { message } — not step-up, but rate-limited`.

The mock's implementation (`tools/mock-gateway/src/routes/broadcast.js`) is the concrete detail that
shapes this design: a broadcast is pushed into the exact same in-game chat stream as a player message,
authored `'[Sistema]'`, via the `chat` SSE event — so "what players will see" is precisely a chat
bubble from `[Sistema]`, renderable with the **exact same `ChatMessageRow` component OC-21 already
built**, not a new preview widget. Once sent, the message will also appear for real in the live Chat
feed a moment later (the operator's own broadcast, streamed back like any other chat message) — the
preview is what it will look like *before* committing, the actual arrival afterward is free
confirmation that it worked.

## Where this lives

The compose bar sits at the bottom of the existing `ChatScreen` (OC-21), below the message list — the
natural home, since a broadcast is visually and functionally an addition to that exact feed, not a
separate concept.

## No step-up, no confirm-by-typing

Contract is explicit: broadcast is *"not step-up."* It also isn't in OC-24's backlog line's named
verbs (`RESTART`/`STOP`), and unlike the lifecycle actions it can't stop a server or drop players —
it sends one visible, attributable, rate-limited chat line. The live preview card is the safeguard
here (see exactly what will be sent before sending it), not typed confirmation or re-authentication.

## Rate limiting: don't guess the server's window

The mock enforces a 5-second cooldown (`RATE_LIMIT_MS = 5000` in `broadcast.js`) and returns a
human-readable `429 rate_limited` on violation — but that exact number is a **mock implementation
detail**, not something the contract itself specifies (§4 only says *"rate-limited"*, no window). This
design deliberately does **not** hardcode a client-side 5-second cooldown timer guessing at the real
gateway's actual limit — that would be inventing a number this repo can't verify and that could be
wrong once ratified against the real `xindeler-zuul`. Instead: the Send button disables while a
request is in flight (`pending`, preventing an accidental double-tap double-send — the same pattern
`useDestructiveAction` established), and a `429` (or any other) error renders via the existing
`gatewayErrorMessage` convention — the gateway's own message ("Esperá unos segundos antes de enviar
otro mensaje" in the mock) is what tells the operator to wait, not a client-guessed countdown.

## Character limit: a documented, client-invented soft cap

The contract sets no maximum length. `MAX_MESSAGE_LENGTH = 200` is a reasonable, revisable client
choice (fits a chat bubble without overflow, matches common in-game-broadcast conventions) —
documented here explicitly as invented, not derived, so a future ratification pass against the real
gateway knows to check whether the server enforces its own (possibly different) limit.

## The component

New `src/features/chat/BroadcastComposer.tsx`:

```tsx
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useApi } from '@/api/ApiContext';
import { useEnvironment } from '@/config/EnvironmentContext';
import { gatewayErrorMessage } from '@/features/connectivity/gatewayErrorMessage';
import { fonts, useTheme } from '@/ui/theme';

import { ChatMessageRow } from './ChatMessageRow';

const MAX_MESSAGE_LENGTH = 200;

export function BroadcastComposer() {
  const api = useApi();
  const { environment } = useEnvironment();
  const { colors } = useTheme();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const trimmed = message.trim();
  const canSend = trimmed.length > 0 && message.length <= MAX_MESSAGE_LENGTH && !sending;

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      await api.write.broadcastMessage(trimmed);
      setMessage('');
    } catch (err) {
      if (err instanceof Error) setError(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <View className="gap-2 border-t border-steel-dark px-4 py-3 dark:border-night-steel-dark">
      {trimmed.length > 0 && (
        <View>
          <Text
            className="mb-1 text-xs text-steel-muted dark:text-night-steel-muted"
            style={{ fontFamily: fonts.regular }}
          >
            Así lo van a ver los jugadores:
          </Text>
          <ChatMessageRow
            message={{ author: '[Sistema]', message: trimmed, ts: new Date().toISOString() }}
          />
        </View>
      )}
      <TextInput
        value={message}
        onChangeText={setMessage}
        placeholder="Mensaje para todos los jugadores…"
        placeholderTextColor={colors.textMuted}
        multiline
        maxLength={MAX_MESSAGE_LENGTH}
        className="rounded-lg border border-steel-dark bg-bg-surface px-3 py-2 text-base text-steel-light dark:border-night-steel-dark dark:bg-night-bg-surface dark:text-night-steel-light"
        style={{ fontFamily: fonts.regular }}
      />
      <View className="flex-row items-center justify-between">
        <Text
          className="text-xs text-steel-muted dark:text-night-steel-muted"
          style={{ fontFamily: fonts.regular }}
        >
          {`${message.length}/${MAX_MESSAGE_LENGTH}`}
        </Text>
        <Pressable
          onPress={handleSend}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend }}
          className={`rounded-full px-4 py-2 ${
            canSend
              ? 'bg-accent-cyan dark:bg-night-accent-cyan'
              : 'bg-steel-dark dark:bg-night-steel-dark'
          }`}
        >
          <Text
            className={
              canSend
                ? 'text-bg-base dark:text-night-bg-base'
                : 'text-steel-muted dark:text-night-steel-muted'
            }
            style={{ fontFamily: fonts.semibold }}
          >
            Enviar
          </Text>
        </Pressable>
      </View>
      {error && (
        <Text className="text-xs text-danger dark:text-night-danger">
          {gatewayErrorMessage(environment.id, error)}
        </Text>
      )}
    </View>
  );
}
```

The preview only renders once there's non-whitespace content (`trimmed.length > 0`) — an empty compose
box showing an empty-author bubble would be noise, not a preview. `message.length` (not `trimmed`)
drives the counter and the max-length gate, matching what `TextInput`'s own `maxLength` enforces, so
the visible number always matches what the input actually allows typing.

**`src/api/writeApi.ts`** gains one more method, reusing the same `OkResponseSchema` (already
tightened to `z.literal(true)` by OC-25/26's safety fixes) the other five methods use:

```ts
broadcastMessage(message: string) {
  return http.request('/api/v1/broadcast', { method: 'POST', body: { message } }, OkResponseSchema);
},
```

No `stepUpCode` parameter — matches the contract's "not step-up" note exactly.

**`ChatScreen.tsx`** gains one import and one line: `<BroadcastComposer />` added as the last child of
the screen's outer `View`, below the existing `FlatList` — nothing else in that file changes.

## Testing

No test runner — `npx tsc --noEmit` / `npm run lint` / `npm run format:check`, plus a live pass
against `npm run mock-gateway`: type a message, confirm the preview card renders with `[Sistema]` as
author and matches `ChatMessageRow`'s normal styling; confirm the counter tracks length and Enviar
disables past 200 chars; send it, confirm the compose field clears and the message shortly appears for
real in the chat feed above (proving the `chat` SSE round-trip); send twice within 5 seconds, confirm
the mock's `429 rate_limited` message renders verbatim via the existing error styling (not a client-
invented cooldown message); send an empty/whitespace-only message, confirm Enviar stays disabled.

## Out of scope

- A client-side rate-limit countdown timer — see "Rate limiting" above.
- Any character limit enforced beyond the client-invented 200 — no server value exists to match yet.
- Confirm-by-typing or step-up on broadcast — contract explicitly excludes it from step-up, and it
  isn't in OC-24's named-verb scope.

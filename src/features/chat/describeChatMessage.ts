import type { ChatMessage } from '@/api/schemas';

// OC-67: `parties`/`content` are `z.unknown()` in `ChatMessageSchema` on purpose — the real
// gateway's shapes (a 13-variant tagged `ChatParties` enum, and `content` typed as the game
// engine's own i18n `Content` resolution system) are real, separate scope to fully model, not
// something to guess at in a validation schema (see that schema's own comment). This is UI
// fallback logic instead — best-effort, defensive, never assumed to be the real contract — so it
// can degrade gracefully as more of the real shape gets confirmed later, without ever having
// silently claimed a wrong shape was validated.
//
// Serde's default "externally tagged" representation for a Rust enum variant carrying data is
// `{"VariantName": <data>}` — `parties`'s outer key is that variant name (Say/Tell/Group/...),
// and the payload is usually a `PlayerInfo{uuid,alias}` (or a list of them for the *Meta variants)
// -- reading `.alias` off whatever's there degrades to just the variant name if it isn't shaped
// that way.
function describeSpeaker(parties: unknown): string {
  if (parties && typeof parties === 'object') {
    const [variant, payload] = Object.entries(parties)[0] ?? [];
    if (!variant) return 'Desconocido';
    const alias = extractAlias(payload);
    return alias ? `${variant} · ${alias}` : variant;
  }
  if (typeof parties === 'string') return parties;
  return 'Desconocido';
}

function extractAlias(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'alias' in payload) {
    const alias = (payload as { alias: unknown }).alias;
    return typeof alias === 'string' ? alias : null;
  }
  if (Array.isArray(payload) && payload.length > 0) {
    return extractAlias(payload[0]);
  }
  return null;
}

// `content` is the engine's own localized-message type — resolving it into real prose needs the
// same i18n machinery the game client uses, which this app doesn't have. Shown as raw JSON rather
// than a fabricated translation.
function describeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content);
  } catch {
    return '(contenido no representable)';
  }
}

export function describeChatMessage(message: ChatMessage): { speaker: string; text: string } {
  return { speaker: describeSpeaker(message.parties), text: describeContent(message.content) };
}

const players = [
  {
    alias: 'Kaelith',
    uuid: '3f1b1e2a-0000-4000-8000-000000000001',
    reference: 'ref-kaelith-0001',
    account_state: 'active',
    online: true,
    email: 'kaelith@example.com',
    email_verified: true,
    flags: [],
    characters: [
      {
        character_id: 101,
        name: 'Kaelith',
        level: 12,
        class: 'Warrior',
        location: { site: 'Port Bastion', kingdom: null, continent: null },
      },
    ],
  },
  {
    alias: 'Voss',
    uuid: '3f1b1e2a-0000-4000-8000-000000000002',
    reference: 'ref-voss-0002',
    account_state: 'active',
    online: true,
    email: 'voss@example.com',
    email_verified: true,
    flags: [],
    characters: [
      { character_id: 102, name: 'Voss', level: 8, class: 'Ranger', location: null },
      { character_id: 103, name: 'Vossling', level: 3, class: 'Ranger', location: null },
    ],
  },
  {
    alias: 'Ember',
    uuid: '3f1b1e2a-0000-4000-8000-000000000003',
    reference: 'ref-ember-0003',
    account_state: 'active',
    online: true,
    email: 'ember@example.com',
    email_verified: true,
    flags: [],
    characters: [
      {
        character_id: 104,
        name: 'Ember',
        level: 20,
        class: 'Mage',
        location: { site: 'Ashfall Keep', kingdom: 'Cindral', continent: null },
      },
    ],
  },
  {
    alias: 'Doran',
    uuid: '3f1b1e2a-0000-4000-8000-000000000004',
    reference: 'ref-doran-0004',
    account_state: 'active',
    online: true,
    email: 'doran@example.com',
    email_verified: true,
    flags: [],
    characters: [],
  },
  {
    alias: 'Nyx',
    uuid: '3f1b1e2a-0000-4000-8000-000000000005',
    reference: 'ref-nyx-0005',
    account_state: 'active',
    online: true,
    email: 'nyx@example.com',
    email_verified: true,
    flags: [],
    characters: [{ character_id: 105, name: 'Nyx', level: 15, class: 'Rogue', location: null }],
  },
  // Offline, never connected this session — proves the directory shows accounts `GET /players`
  // (online-only) never could.
  {
    alias: 'Thistle',
    uuid: '3f1b1e2a-0000-4000-8000-000000000006',
    reference: 'ref-thistle-0006',
    account_state: 'active',
    online: false,
    email: 'thistle@example.com',
    email_verified: true,
    flags: [],
    characters: [{ character_id: 106, name: 'Thistle', level: 5, class: 'Cleric', location: null }],
  },
  // Already flagged + blocked — exercises the account-state badge and the flags list without
  // needing a live ban/flag action first.
  {
    alias: 'Grix',
    uuid: '3f1b1e2a-0000-4000-8000-000000000007',
    reference: 'ref-grix-0007',
    account_state: 'blocked',
    online: true,
    email: 'grix@example.com',
    email_verified: true,
    flags: [
      {
        id: 1,
        color: 'yellow',
        reason: 'Lenguaje inapropiado en chat global',
        issued_by_operator_uuid: '11111111-1111-4111-8111-111111111111',
        issued_at: Math.floor(Date.now() / 1000) - 86400,
        decay_at: Math.floor(Date.now() / 1000) + 86400 * 6,
        ban_until: null,
        revoked_at: null,
        revoked_by_operator_uuid: null,
      },
    ],
    characters: [{ character_id: 107, name: 'Grix', level: 30, class: 'Warrior', location: null }],
  },
];

// OC-67: shape matches the real gateway's `ChatMessage` (`xindeler-new-horizon/server/src/chat.rs`
// -- confirmed source, not guessed) -- `parties` is a tagged enum keyed by variant name (`Say`
// here, the plain-chat case), each carrying a `PlayerInfo{uuid,alias}`. `content` is the engine's
// own i18n-resolved type in reality; kept as a plain string here since this mock's own consumers
// only ever display it as text (see `describeChatMessage.ts`'s `content` fallback, which also
// accepts a bare string).
const chatMessages = [
  {
    parties: { Say: { uuid: 'mock-kaelith', alias: 'Kaelith' } },
    content: 'alguien vio el faro nuevo?',
  },
  {
    parties: { Say: { uuid: 'mock-voss', alias: 'Voss' } },
    content: 'si, queda al norte del puerto',
  },
  { parties: { Say: { uuid: 'mock-ember', alias: 'Ember' } }, content: 'gracias!' },
  {
    parties: { Say: { uuid: 'mock-doran', alias: 'Doran' } },
    content: 'cuidado con los lobos cerca del bosque',
  },
];

// Two messages per turn, cycling through the pool round-robin — same deterministic-not-random
// approach `oracleDraftPool` already uses below, so a live-verification pass can assert exact
// expected content per send rather than "some pair of messages."
let contextIndex = 0;
function nextContextSnippets() {
  const snippets = [
    chatMessages[contextIndex % chatMessages.length],
    chatMessages[(contextIndex + 1) % chatMessages.length],
  ];
  contextIndex = (contextIndex + 2) % chatMessages.length;
  return snippets.map((snippet) => ({ ...snippet, time: new Date().toISOString() }));
}

const logLineTemplates = [
  { level: 'info', target: 'xindeler::server', message: 'Tick completado en 42ms' },
  { level: 'info', target: 'xindeler::net', message: 'Jugador conectado' },
  { level: 'warn', target: 'xindeler::world', message: 'Chunk tardó más de 100ms en generarse' },
  { level: 'error', target: 'xindeler::net', message: 'Timeout esperando ack del cliente' },
  { level: 'debug', target: 'xindeler::ecs', message: 'Sistema de física ejecutado' },
  { level: 'info', target: 'xindeler::server', message: 'Guardado automático completado' },
];

// OC-71: flat id strings, matching real `/oracle/events`'s `entity_templates` (confirmed via the
// peer session's ZG-64 report) -- the real engine has no display-name field for a template, only
// its id.
const entityTemplates = ['tpl_wolf_pack', 'tpl_bandit_camp', 'tpl_storm_elemental'];

// OC-71: `title`/`summary`, not `name` -- matches the real `OraclePreset` shape read directly from
// `xindeler-zuul/server/src/presets.rs`.
const oraclePresets = [
  {
    id: 'preset_wolf_ambush',
    title: 'Emboscada de lobos',
    summary: 'Genera una manada de lobos cerca del objetivo.',
    dm_event: { kind: 'spawn', template_id: 'tpl_wolf_pack', intensity: 6, radius: 20 },
  },
  {
    id: 'preset_magic_storm',
    title: 'Tormenta mágica',
    summary: 'Guarda un evento de clima mágico (todavía no aplicado por el motor).',
    dm_event: { kind: 'weather', intensity: 8, radius: 50 },
  },
  {
    id: 'preset_bandit_raid',
    title: 'Asalto de bandidos',
    summary: 'Genera un campamento de bandidos cerca del objetivo.',
    dm_event: { kind: 'spawn', template_id: 'tpl_bandit_camp', intensity: 5, radius: 30 },
  },
];

const oracleCannedReply =
  'Puedo generar un evento de emboscada de lobos cerca del jugador. ¿Confirmás?';

const oracleDraftPool = [
  { kind: 'spawn', template_id: 'tpl_wolf_pack', intensity: 6, radius: 20 },
  { kind: 'weather', intensity: 8, radius: 50 },
];

module.exports = {
  players,
  chatMessages,
  logLineTemplates,
  entityTemplates,
  oraclePresets,
  oracleCannedReply,
  oracleDraftPool,
  nextContextSnippets,
};

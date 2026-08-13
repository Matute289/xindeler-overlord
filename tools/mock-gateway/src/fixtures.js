const players = [
  { alias: 'Kaelith', uuid: '3f1b1e2a-0000-4000-8000-000000000001' },
  { alias: 'Voss', uuid: '3f1b1e2a-0000-4000-8000-000000000002' },
  { alias: 'Ember', uuid: '3f1b1e2a-0000-4000-8000-000000000003' },
  { alias: 'Doran', uuid: '3f1b1e2a-0000-4000-8000-000000000004' },
  { alias: 'Nyx', uuid: '3f1b1e2a-0000-4000-8000-000000000005' },
];

const chatMessages = [
  { author: 'Kaelith', message: 'alguien vio el faro nuevo?' },
  { author: 'Voss', message: 'si, queda al norte del puerto' },
  { author: 'Ember', message: 'gracias!' },
  { author: 'Doran', message: 'cuidado con los lobos cerca del bosque' },
];

const logLineTemplates = [
  { level: 'info', target: 'xindeler::server', message: 'Tick completado en 42ms' },
  { level: 'info', target: 'xindeler::net', message: 'Jugador conectado' },
  { level: 'warn', target: 'xindeler::world', message: 'Chunk tardó más de 100ms en generarse' },
  { level: 'error', target: 'xindeler::net', message: 'Timeout esperando ack del cliente' },
  { level: 'debug', target: 'xindeler::ecs', message: 'Sistema de física ejecutado' },
  { level: 'info', target: 'xindeler::server', message: 'Guardado automático completado' },
];

const entityTemplates = [
  { id: 'tpl_wolf_pack', name: 'Manada de lobos' },
  { id: 'tpl_bandit_camp', name: 'Campamento de bandidos' },
  { id: 'tpl_storm_elemental', name: 'Elemental de tormenta' },
];

const oraclePresets = [
  {
    id: 'preset_wolf_ambush',
    name: 'Emboscada de lobos',
    dm_event: { kind: 'spawn', template_id: 'tpl_wolf_pack', intensity: 6, radius: 20 },
  },
  {
    id: 'preset_magic_storm',
    name: 'Tormenta mágica',
    dm_event: { kind: 'weather', intensity: 8, radius: 50 },
  },
  {
    id: 'preset_bandit_raid',
    name: 'Asalto de bandidos',
    dm_event: { kind: 'spawn', template_id: 'tpl_bandit_camp', intensity: 5, radius: 30 },
  },
];

module.exports = {
  players,
  chatMessages,
  logLineTemplates,
  entityTemplates,
  oraclePresets,
};

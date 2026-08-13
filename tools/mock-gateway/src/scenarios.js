const { state } = require('./state');
const { broadcast } = require('./sse');
const { players, logLineTemplates } = require('./fixtures');

const VALID_SCENARIOS = ['normal', 'down', 'draining', 'log_flood', 'auth_expiry', 'stream_drop'];

function clearTimers() {
  if (state.logGeneratorTimer) {
    clearInterval(state.logGeneratorTimer);
    state.logGeneratorTimer = null;
  }
  if (state.drainingCountdown) {
    clearInterval(state.drainingCountdown.timer);
    state.drainingCountdown = null;
  }
  if (state.recoveryTimers) {
    state.recoveryTimers.forEach(clearTimeout);
    state.recoveryTimers = null;
  }
}

function pushLogLine() {
  const template = logLineTemplates[Math.floor(Math.random() * logLineTemplates.length)];
  const line = {
    ts: new Date().toISOString(),
    level: template.level,
    target: template.target,
    message: template.message,
  };
  state.logBuffer.push(line);
  if (state.logBuffer.length > 500) state.logBuffer.shift();
  broadcast('log', line);
}

function startLogGenerator() {
  const rateMs =
    state.scenario === 'log_flood'
      ? Math.max(1, Math.round(1000 / state.scenarioParams.log_flood.logsPerSec))
      : 3000;
  state.logGeneratorTimer = setInterval(pushLogLine, rateMs);
}

function statusSnapshot() {
  if (state.scenario === 'down') {
    return {
      service: 'inactive',
      health: false,
      version: '0.1.0-mock',
      started_at: null,
      uptime_secs: 0,
      players_online: 0,
      tick_time_ms: null,
      entity_count: 0,
      chunk_count: 0,
      pending_shutdown: null,
    };
  }
  const base = {
    service: 'active',
    health: true,
    version: '0.1.0-mock',
    started_at: new Date(state.serverStartedAt).toISOString(),
    uptime_secs: Math.floor((Date.now() - state.serverStartedAt) / 1000),
    players_online: players.length,
    tick_time_ms: 45 + Math.floor(Math.random() * 10),
    entity_count: 1200 + Math.floor(Math.random() * 50),
    chunk_count: 340 + Math.floor(Math.random() * 20),
    pending_shutdown: null,
  };
  if (state.scenario === 'draining' && state.drainingCountdown) {
    base.pending_shutdown = {
      seconds_left: state.drainingCountdown.secondsLeft,
      reason: 'Restart solicitado',
    };
  }
  return base;
}

function startDrainingCountdown() {
  const totalSeconds = state.scenarioParams.draining.seconds;
  state.drainingCountdown = { secondsLeft: totalSeconds, timer: null };
  broadcast('lifecycle', { state: 'draining', seconds_left: totalSeconds });
  broadcast('status', statusSnapshot());

  state.drainingCountdown.timer = setInterval(() => {
    if (!state.drainingCountdown) return; // scenario was switched away mid-countdown
    state.drainingCountdown.secondsLeft -= 1;

    if (state.drainingCountdown.secondsLeft > 0) {
      broadcast('lifecycle', { state: 'draining', seconds_left: state.drainingCountdown.secondsLeft });
      broadcast('status', statusSnapshot());
      return;
    }

    clearInterval(state.drainingCountdown.timer);
    state.drainingCountdown = null;
    broadcast('lifecycle', { state: 'stopped' });

    state.recoveryTimers = [];
    const startingTimer = setTimeout(() => {
      broadcast('lifecycle', { state: 'starting' });
      const runningTimer = setTimeout(() => {
        state.scenario = 'normal';
        state.recoveryTimers = null;
        broadcast('lifecycle', { state: 'running' });
        broadcast('status', statusSnapshot());
      }, 1500);
      state.recoveryTimers.push(runningTimer);
    }, 1500);
    state.recoveryTimers.push(startingTimer);
  }, 1000);
}

function setScenario(name, params) {
  if (!VALID_SCENARIOS.includes(name)) {
    const err = new Error(`Unknown scenario '${name}'`);
    err.code = 'invalid_scenario';
    throw err;
  }
  if (params) {
    for (const key of Object.keys(params)) {
      if (!state.scenarioParams[name] || !(key in state.scenarioParams[name])) {
        const err = new Error(`Unknown param '${key}' for scenario '${name}'`);
        err.code = 'invalid_scenario_param';
        throw err;
      }
      state.scenarioParams[name][key] = params[key];
    }
  }

  clearTimers();
  state.scenario = name;
  startLogGenerator();
  if (name === 'draining') startDrainingCountdown();

  broadcast('status', statusSnapshot());
  broadcast('lifecycle', name === 'down' ? { state: 'stopped' } : { state: 'running' });
}

function getScenarioSnapshot() {
  return { scenario: state.scenario, params: state.scenarioParams };
}

module.exports = { setScenario, getScenarioSnapshot, statusSnapshot, VALID_SCENARIOS };

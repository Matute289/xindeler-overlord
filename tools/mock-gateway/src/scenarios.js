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

function pushLogLine(override) {
  const template =
    override || logLineTemplates[Math.floor(Math.random() * logLineTemplates.length)];
  const line = {
    ts: new Date().toISOString(),
    level: template.level,
    target: template.target,
    message: template.message,
  };
  state.logBuffer.push(line);
  if (state.logBuffer.length > 500) state.logBuffer.shift();
  broadcast('log', line);
  return line;
}

function startLogGenerator() {
  if (state.scenario === 'down') return; // no log activity while the server is "down"
  const rateMs =
    state.scenario === 'log_flood'
      ? Math.max(1, Math.round(1000 / state.scenarioParams.log_flood.logsPerSec))
      : 3000;
  state.logGeneratorTimer = setInterval(pushLogLine, rateMs);
}

// OC-63: shape matches xindeler-zuul's real `GET /status` (`server/src/status.rs`'s
// `StatusResponse`/`EngineInfo`) -- `game_server` is `systemctl is-active`'s raw vocabulary, `info`
// is `null` whenever the engine itself is unreachable (which "stopped"/"starting" both are, on a
// real server -- there is no engine process to ask yet). No `chunk_count`: the real gateway has no
// path to it either, see `src/api/schemas.ts`'s comment on `EngineInfoSchema`.
function statusSnapshot() {
  if (state.scenario === 'down' || state.lifecyclePhase === 'stopped') {
    return { game_server: 'inactive', info: null, restart: null };
  }
  if (state.lifecyclePhase === 'starting') {
    return { game_server: 'activating', info: null, restart: null };
  }

  const info = {
    version: '0.1.0-mock',
    player_count: players.length,
    shutdown_pending_secs: null,
    tick_time_ms: 45 + Math.floor(Math.random() * 10),
    entity_count: 1200 + Math.floor(Math.random() * 50),
    uptime_secs: Math.floor((Date.now() - state.serverStartedAt) / 1000),
    shutdown_reason: null,
  };
  if (state.lifecyclePhase === 'draining' && state.drainingCountdown) {
    info.shutdown_pending_secs = state.drainingCountdown.secondsLeft;
    info.shutdown_reason = state.shutdownReason || 'Restart solicitado';
  }
  return { game_server: 'active', info, restart: null };
}

function beginGracefulStop({ seconds, reason, autoRestart }) {
  // Any in-flight countdown/recovery must die first — this function has three callers
  // (the `draining` scenario, POST /server/restart, POST /server/stop) and two of them
  // do not clearTimers() beforehand. A surviving interval would decrement the new
  // countdown in parallel and run its own stale `autoRestart` tail.
  if (state.drainingCountdown) {
    clearInterval(state.drainingCountdown.timer);
    state.drainingCountdown = null;
  }
  if (state.recoveryTimers) {
    state.recoveryTimers.forEach(clearTimeout);
    state.recoveryTimers = null;
  }

  state.drainingCountdown = { secondsLeft: seconds, timer: null };
  state.lifecyclePhase = 'draining';
  state.shutdownReason = reason || null;
  broadcast('status', statusSnapshot());

  state.drainingCountdown.timer = setInterval(() => {
    if (!state.drainingCountdown) return; // scenario was switched away mid-countdown
    state.drainingCountdown.secondsLeft -= 1;

    if (state.drainingCountdown.secondsLeft > 0) {
      state.lifecyclePhase = 'draining';
      broadcast('status', statusSnapshot());
      return;
    }

    clearInterval(state.drainingCountdown.timer);
    state.drainingCountdown = null;
    state.lifecyclePhase = 'stopped';
    if (!autoRestart) {
      state.scenario = 'down';
      if (state.logGeneratorTimer) {
        clearInterval(state.logGeneratorTimer);
        state.logGeneratorTimer = null;
      }
    }
    broadcast('status', statusSnapshot());

    if (!autoRestart) return; // stays stopped until POST /server/start

    state.recoveryTimers = [];
    const startingTimer = setTimeout(() => {
      state.lifecyclePhase = 'starting';
      broadcast('status', statusSnapshot());
      const runningTimer = setTimeout(() => {
        state.scenario = 'normal';
        state.recoveryTimers = null;
        state.lifecyclePhase = 'running';
        state.shutdownReason = null;
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
      if (
        !state.scenarioParams[name] ||
        !Object.prototype.hasOwnProperty.call(state.scenarioParams[name], key)
      ) {
        const err = new Error(`Unknown param '${key}' for scenario '${name}'`);
        err.code = 'invalid_scenario_param';
        throw err;
      }
      if (name === 'log_flood' && key === 'logsPerSec') {
        const value = params[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
          const err = new Error("'logsPerSec' must be a finite number >= 1");
          err.code = 'invalid_scenario_param';
          throw err;
        }
      }
      state.scenarioParams[name][key] = params[key];
    }
  }

  clearTimers();
  state.scenario = name;
  startLogGenerator();
  if (name === 'draining') {
    beginGracefulStop({
      seconds: state.scenarioParams.draining.seconds,
      reason: 'Restart solicitado',
      autoRestart: true,
    });
  } else {
    state.lifecyclePhase = name === 'down' ? 'stopped' : 'running';
  }

  broadcast('status', statusSnapshot());
}

function stopImmediately(reason) {
  clearTimers();
  state.scenario = 'down';
  state.lifecyclePhase = 'stopped';
  state.shutdownReason = reason || null;
  broadcast('status', statusSnapshot());
}

function startServer() {
  if (state.lifecyclePhase === 'running') return; // already running, no-op success
  clearTimers();
  state.lifecyclePhase = 'starting';
  broadcast('status', statusSnapshot());
  const runningTimer = setTimeout(() => {
    state.scenario = 'normal';
    startLogGenerator();
    state.lifecyclePhase = 'running';
    state.shutdownReason = null;
    broadcast('status', statusSnapshot());
  }, 1500);
  state.recoveryTimers = [runningTimer];
}

function cancelShutdown() {
  if (state.lifecyclePhase !== 'draining') {
    const err = new Error('No hay una detención en curso para cancelar');
    err.code = 'no_pending_shutdown';
    throw err;
  }
  clearTimers();
  state.scenario = 'normal';
  startLogGenerator();
  state.lifecyclePhase = 'running';
  state.shutdownReason = null;
  broadcast('status', statusSnapshot());
}

function getScenarioSnapshot() {
  return { scenario: state.scenario, params: state.scenarioParams };
}

module.exports = {
  setScenario,
  getScenarioSnapshot,
  statusSnapshot,
  VALID_SCENARIOS,
  beginGracefulStop,
  stopImmediately,
  startServer,
  cancelShutdown,
  pushLogLine,
};

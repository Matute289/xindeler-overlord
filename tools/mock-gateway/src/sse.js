const { state } = require('./state');

function writeEventTo(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    unregisterClient(res);
  }
}

function registerClient(res) {
  state.streamClients.add(res);
  res.on('error', () => {
    unregisterClient(res);
  });
}

function unregisterClient(res) {
  state.streamClients.delete(res);
}

function broadcast(event, data) {
  for (const res of state.streamClients) {
    writeEventTo(res, event, data);
  }
}

module.exports = { writeEventTo, registerClient, unregisterClient, broadcast };

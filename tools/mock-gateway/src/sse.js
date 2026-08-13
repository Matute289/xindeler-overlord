const { state } = require('./state');

function writeEventTo(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function registerClient(res) {
  state.streamClients.add(res);
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

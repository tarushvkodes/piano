#!/usr/bin/env node
const os = require('os');
const { WebSocketServer } = require('ws');

const port = Number(process.env.PIANO_SYNC_PORT || 8787);
const server = new WebSocketServer({ port, host: '0.0.0.0' });
const clients = new Set();

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

server.on('connection', (socket, request) => {
  clients.add(socket);
  socket.send(JSON.stringify({
    type: 'bridge-ready',
    message: 'Connected to FP-10 Quest sync bridge',
  }));

  socket.on('message', (data) => {
    for (const client of clients) {
      if (client !== socket && client.readyState === client.OPEN) {
        client.send(data.toString());
      }
    }
  });

  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));

  const origin = request.socket.remoteAddress || 'unknown';
  console.log(`client connected from ${origin}; ${clients.size} client(s) online`);
});

function printListening() {
  console.log(`FP-10 sync bridge listening on ws://0.0.0.0:${port}`);
  for (const address of localAddresses()) {
    console.log(`Desktop/LAN clients can use ws://${address}:${port}`);
  }
}

server.on('listening', printListening);

server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

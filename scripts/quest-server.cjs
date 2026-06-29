#!/usr/bin/env node
const { createServer } = require('https');
const { existsSync, readFileSync, statSync } = require('fs');
const os = require('os');
const { extname, join, normalize } = require('path');
const { WebSocketServer } = require('ws');

const root = join(__dirname, '..');
const dist = join(root, 'dist');
const keyPath = join(root, '.cert', 'quest-dev-key.pem');
const certPath = join(root, '.cert', 'quest-dev-cert.pem');
const port = Number(process.env.PIANO_QUEST_PORT || 5173);
const clients = new Set();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  '.json': 'application/json; charset=utf-8',
};

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

function sendFile(response, filePath) {
  const type = mimeTypes[extname(filePath)] || 'application/octet-stream';
  response.writeHead(200, { 'content-type': type });
  response.end(readFileSync(filePath));
}

const server = createServer({
  key: readFileSync(keyPath),
  cert: readFileSync(certPath),
}, (request, response) => {
  const url = new URL(request.url, `https://${request.headers.host}`);
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(dist, requested === '/' ? 'index.html' : requested);

  if (!filePath.startsWith(dist)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(dist, 'index.html');
  }

  sendFile(response, filePath);
});

const wsServer = new WebSocketServer({ server, path: '/sync' });

wsServer.on('connection', (socket, request) => {
  clients.add(socket);
  socket.send(JSON.stringify({ type: 'bridge-ready', message: 'Connected to Quest sync' }));
  socket.on('message', (data) => {
    for (const client of clients) {
      if (client !== socket && client.readyState === client.OPEN) client.send(data.toString());
    }
  });
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
  console.log(`client connected from ${request.socket.remoteAddress}; ${clients.size} client(s) online`);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`FP-10 Quest HTTPS app listening on https://0.0.0.0:${port}`);
  for (const address of localAddresses()) {
    console.log(`Open on Quest: https://${address}:${port}`);
    console.log(`Sync URL: wss://${address}:${port}/sync`);
  }
});

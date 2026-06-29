#!/usr/bin/env node
const { existsSync, mkdirSync } = require('fs');
const os = require('os');
const { dirname, join } = require('path');
const { spawnSync } = require('child_process');

const root = join(__dirname, '..');
const certDir = join(root, '.cert');
const keyPath = join(certDir, 'quest-dev-key.pem');
const certPath = join(certDir, 'quest-dev-cert.pem');

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

if (existsSync(keyPath) && existsSync(certPath)) {
  console.log(`Using existing Quest dev cert at ${certPath}`);
  process.exit(0);
}

mkdirSync(dirname(keyPath), { recursive: true });

const result = spawnSync('openssl', [
  'req',
  '-x509',
  '-newkey', 'rsa:2048',
  '-nodes',
  '-keyout', keyPath,
  '-out', certPath,
  '-sha256',
  '-days', '365',
  '-subj', '/CN=piano-quest.local',
  '-addext', `subjectAltName=DNS:localhost,IP:127.0.0.1,${localAddresses().map((address) => `IP:${address}`).join(',')}`,
], { stdio: 'inherit' });

if (result.status !== 0) {
  console.error('Could not generate Quest dev certificate with openssl.');
  process.exit(result.status || 1);
}

console.log(`Generated Quest dev cert at ${certPath}`);

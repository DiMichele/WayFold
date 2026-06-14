/**
 * tunnel.js — Avvia cloudflared e stampa l'URL pubblico in console
 */

const { spawn } = require('child_process');
const path = require('path');
const config = require('../server/config');

const cloudflared = path.join(__dirname, '..', 'tools', 'cloudflared.exe');
const target = `http://localhost:${config.PORT}`;

const child = spawn(cloudflared, ['tunnel', '--url', target], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let printed = false;

function onLine(line) {
  const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (match && !printed) {
    printed = true;
    console.log(`🌐  Tunnel → ${match[0]}`);
  }
}

function onData(buf) {
  for (const line of buf.toString().split(/\r?\n/)) {
    if (line.trim()) onLine(line);
  }
}

child.stdout.on('data', onData);
child.stderr.on('data', onData);

child.on('error', (err) => {
  console.error('❌  Tunnel non avviato:', err.message);
  process.exit(1);
});

child.on('exit', (code) => {
  if (code && code !== 0) console.error(`⚠️  Tunnel terminato (codice ${code})`);
  process.exit(code ?? 0);
});

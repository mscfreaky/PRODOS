import http from 'node:http';
import net from 'node:net';
import { makeDemoState } from './demo.js';
import { createCloudTally, cameraStatus } from './cloud-tally.js';
import { createProduction } from './production.js';
import { attachExisting } from './instance.js';
import { setTimeout as delay } from 'node:timers/promises';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const demo = process.argv.includes('--demo');
const host = argValue('--host');
if (!demo && (!host || net.isIP(host) !== 4)) {
  console.error('ERROR: Provide a valid IPv4 address with --host.');
  process.exit(2);
}

let atem = null;
let connected = demo;
let lastError = null;
let state = demo ? makeDemoState() : null;
let version = state ? 1 : 0;
let lastUpdate = state ? new Date().toISOString() : null;
let retryTimer = null;
let shuttingDown = false;
let connecting = false;

function changed() {
  version += 1;
  lastUpdate = new Date().toISOString();
}
function scheduleReconnect() {
  connected = false;
  connecting = false;
  if (shuttingDown || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connectAtem();
  }, 4000);
}
async function connectAtem() {
  if (shuttingDown || connecting || connected || !atem) return;
  connecting = true;
  try {
    await atem.connect(host);
    // 'connected' is emitted only after the initial state arrives.
  } catch (error) {
    lastError = String(error);
    scheduleReconnect();
  } finally {
    connecting = false;
  }
}

if (demo) {
  const sequence = [1, 2, 3, 4, 5];
  let index = 0;
  const demoTimer = setInterval(() => {
    index = (index + 1) % sequence.length;
    state = makeDemoState(sequence[index], sequence[(index + 1) % sequence.length]);
    changed();
  }, 5000);
  demoTimer.unref();
} else {
  try {
    const { Atem } = await import('atem-connection');
    atem = new Atem();
    atem.on('connected', () => {
      connected = true;
      connecting = false;
      lastError = null;
      state = atem.state;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      changed();
    });
    atem.on('disconnected', () => {
      lastError = 'ATEM connection lost';
      scheduleReconnect();
    });
    atem.on('error', (error) => {
      lastError = String(error);
      if (!connected) scheduleReconnect();
    });
    atem.on('stateChanged', () => {
      state = atem.state;
      changed();
    });
  } catch (error) {
    console.error('ERROR: ATEM library missing. Run 01_SETUP_AND_BUILD.cmd first.');
    console.error(String(error));
    process.exit(3);
  }
}

// Public tunnel gets its own isolated server with only /tally/1..8 routes.
// Internal /state and /cloud management are not reachable through the tunnel.
let adminPort = 0;
const getStatus = () => ({ state, connected, demo });
let production;
try {
  for (let attempt = 0; ; attempt++) {
    try { production = createProduction(getStatus, cameraStatus, { adminPort: () => adminPort }); break; }
    catch (error) {
      if (error.code !== 'EDATAINUSE') throw error;
      if (process.argv.includes('--reuse-existing') && error.owner?.port) {
        if (await attachExisting(error.owner, { demo, host })) process.exit(0);
      }
      if (attempt >= 30) throw error;
      await delay(100);
    }
  }
} catch (error) { console.error('START_ERROR: ' + error.message); process.exit(5); }
const cloudTally = await createCloudTally(getStatus, { adminPort: () => adminPort, production });
production.attach(cloudTally);
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${adminPort}` || (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${adminPort}`)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (req.method === 'GET' && req.url === '/instance') {
      if (req.headers['x-instance-key'] !== production.owner().nonce) { res.writeHead(403); res.end('Forbidden'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ pid: process.pid, version: '1.0.0', demo, host: host || null })); return;
    }
    if (await production.handle(req, res, true)) return;
    if (await cloudTally.handlePrivate(req, res)) return;
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(error) }));
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' || req.url !== '/state') {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  try {
    // BigInt values can occur in external state objects.
    const body = JSON.stringify({ connected, lastError, lastUpdate, version, demo, state },
      (_key, value) => typeof value === 'bigint' ? value.toString() : value);
    res.writeHead(200);
    res.end(body);
  } catch (error) {
    res.writeHead(500);
    res.end(JSON.stringify({ connected: false, lastError: 'JSON export failed: ' + String(error), version, state: null }));
  }
});
server.on('error', (error) => {
  console.error('ERROR: Local HTTP server: ' + String(error));
  process.exit(4);
});
server.listen(0, '127.0.0.1', () => {
  adminPort = server.address().port;
  production.setOwner({ port: adminPort, demo, host: host || null });
  console.log(`READY ${adminPort}`);
  console.log(`PRODUCTION http://127.0.0.1:${adminPort}/production`);
  if (!demo) connectAtem();
});
function shutdown() {
  shuttingDown = true;
  if (retryTimer) clearTimeout(retryTimer);
  cloudTally.stop();
  try { atem?.disconnect(); } catch { /* ignore shutdown error */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

import http from 'node:http';
import {createTunnelProcess} from './tunnel-process.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { tallyPage, adminPage } from './cloud-pages.js';
import QRCode from 'qrcode';

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};

function sourcesFor(source, state) {
  if (!Number.isInteger(source)) return [];
  if (source >= 1 && source <= 8) return [source];
  if (source !== 6000) return [];
  return (state?.video?.superSources?.[0]?.boxes ?? [])
    .filter(box => box?.enabled && Number.isInteger(box?.source) && box.source >= 1 && box.source <= 8)
    .map(box => box.source);
}

export function cameraStatus(number, state, connected) {
  const cameraName = state?.inputs?.[String(number)]?.longName || `Camera ${number}`;
  if (!connected || !state) return { number, name: cameraName, status: 'offline' };
  const me = state?.video?.mixEffects?.[0] ?? {};
  const onProgram = new Set(sourcesFor(me.programInput, state));
  const onPreview = new Set(sourcesFor(me.previewInput, state));
  // Live keyers can add a camera to the composed program, even when the base source is different.
  for (const keyer of me.upstreamKeyers ?? []) {
    if (keyer?.onAir) {
      for (const n of sourcesFor(keyer.fillSource, state)) onProgram.add(n);
    }
  }
  // The mini supports downstream keyers. Those are usually still images, but handle camera fill too.
  for (const keyer of state?.video?.downstreamKeyers ?? []) {
    if (keyer?.onAir) {
      for (const n of sourcesFor(keyer.sources?.fillSource, state)) onProgram.add(n);
    }
  }
  const status = onProgram.has(number) ? 'program' : (onPreview.has(number) ? 'preview' : 'off');
  return { number, name: cameraName, status };
}

function json(res, value, status = 200) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
function html(res, body, status = 200) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

function resolveCloudflared() {
  if (process.env.CLOUDFLARED_EXE && existsSync(process.env.CLOUDFLARED_EXE)) return process.env.CLOUDFLARED_EXE;
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'cloudflared', 'cloudflared.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'cloudflared', 'cloudflared.exe'),
      path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe')
    ];
    for (const c of candidates) if (existsSync(c)) return c;
  }
  return 'cloudflared';
}

// Schedule is persisted outside the published application so it survives a restart.
const configFile = process.env.ATEM_TALLY_CONFIG_PATH || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.config'), 'PRODOS', 'show-clock.json');
export function validateSchedule(body) {
  if (body?.clear === true) return null;
  const start = body?.startAt, end = body?.endAt;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start || end - start > 36 * 3600000 ||
      start < Date.now() - 366 * 86400000 || start > Date.now() + 366 * 86400000) {
    throw new Error('Invalid start/end time (end after start, max. 36 hours, within one year).');
  }
  return { startAt: start, endAt: end };
}
export function normalizeChatText(input) {
  if (typeof input !== 'string') throw new Error('Message must be text.');
  const value = input.trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
  if (!value || value.length > 240) throw new Error('Message must contain 1 to 240 characters.');
  return value;
}
function readSchedule() {
  try { const d = JSON.parse(readFileSync(configFile, 'utf8')); return validateSchedule(d); }
  catch { return null; }
}
function saveSchedule(schedule) {
  mkdirSync(path.dirname(configFile), { recursive: true });
  const temp = configFile + '.tmp';
  writeFileSync(temp, JSON.stringify(schedule), { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, configFile);
}
async function jsonBody(req, maxSize = 4096) {
  const pieces = []; let length = 0;
  for await (const piece of req) {
    length += piece.length;
    if (length > maxSize) throw Object.assign(new Error('Request too large'), { status: 413 });
    pieces.push(piece);
  }
  try { return JSON.parse(Buffer.concat(pieces).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

export async function createCloudTally(getStatus, options = {}) {
  let tallyPort = 0;
  let schedule = readSchedule();
  let chat = [], nextMessageId = 0;
  const lastReply = new Map(); // Simple anti-spam without authentication.
  function addMessage(message) {
    const record = { id: ++nextMessageId, at: Date.now(), ...message };
    chat.push(record);
    if (chat.length > 100) chat = chat.slice(-100);
    return record;
  }
  const messagesForCamera = (number) => chat.filter(m => (m.from === 'regie' && (m.to === 'all' || m.to === number)) || (m.from === 'camera' && m.camera === number)).slice(-30).map(m => ({
    ...m,
    acknowledged: m.from === 'regie' ? chat.some(reply => reply.from === 'camera' && reply.camera === number && reply.ackFor === m.id) : false
  }));
  const publicServer = http.createServer(async (req, res) => {
    try {
      if (options.production) {
        if (await options.production.handle(req, res, false)) return;
        return json(res, { error: 'Not found' }, 404);
      }
      const pathName = new URL(req.url, 'http://localhost').pathname;
      const matchPage = /^\/tally\/([1-8])\/?$/.exec(pathName);
      const matchStatus = /^\/tally\/([1-8])\/status$/.exec(pathName);
      const matchReply = /^\/tally\/([1-8])\/reply$/.exec(pathName);
      if (req.method === 'GET' && matchPage) return html(res, tallyPage(Number(matchPage[1])));
      if (req.method === 'GET' && matchStatus) {
        const number = Number(matchStatus[1]);
        const { state, connected } = getStatus();
        return json(res, { ...cameraStatus(number, state, connected), serverTime: Date.now(), schedule, messages: messagesForCamera(number) });
      }
      if (req.method === 'POST' && matchReply) {
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, { error: 'JSON erforderlich' }, 415);
        const number = Number(matchReply[1]);
        const peer = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown').slice(0, 100) + ':' + number;
        if ((lastReply.get(peer) || 0) > Date.now() - 1100) return json(res, { error: 'Please wait' }, 429);
        const body = await jsonBody(req);
        const text = normalizeChatText(body?.text);
        const ackFor = body?.ackFor == null ? null : body.ackFor;
        if (ackFor !== null && (!Number.isSafeInteger(ackFor) || !chat.some(m => m.id === ackFor && m.from === 'regie' && (m.to === 'all' || m.to === number)))) {
          return json(res, { error: 'Cue not found' }, 400);
        }
        lastReply.set(peer, Date.now());
        if (lastReply.size > 1000) lastReply.clear();
        const record = addMessage({ from: 'camera', camera: number, to: 'regie', text, ackFor });
        return json(res, { ok: true, message: record }, 201);
      }
      return json(res, { error: 'Not found' }, 404);
    } catch (error) { return json(res, { error: error.message || 'Fehler' }, error.status || 400); }
  });
  await new Promise((resolve, reject) => {
    publicServer.once('error', reject);
    publicServer.listen(0, '127.0.0.1', resolve);
  });
  tallyPort = publicServer.address().port;
  const tunnelProcess = createTunnelProcess(resolveCloudflared,tallyPort,options.tunnelOptions);
  const getInfo = () => {
    const { state, connected, demo } = getStatus();
    return {
      ...tunnelProcess.info(),
      demo: !!demo,
      showId: options.production?.store.active.id,
      accessVersion: options.production ? options.production.store.active.id + ':' + options.production.store.active.tokens.camera1.slice(0, 12) : '',
      schedule: options.production ? options.production.store.active.schedule : schedule,
      chat: options.production ? options.production.legacyMessages().slice(-80) : chat.slice(-80),
      cameras: Array.from({ length: 8 }, (_, i) => cameraStatus(i + 1, state, connected))
    };
  };
  const stopTunnel = () => tunnelProcess.stop();
  const startTunnel = () => tunnelProcess.start();
  async function handlePrivate(req, res) {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const {publicUrl}=tunnelProcess.info();
    if (!pathname.startsWith('/cloud')) return false;
    // No public tunnel routes to this server; additionally reject cross-origin mutations.
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      const expected = `http://127.0.0.1:${options.adminPort?.()}`;
      if (origin && origin !== expected) { json(res, { error: 'Invalid origin' }, 403); return true; }
      if (pathname === '/cloud/start') { startTunnel(); json(res, getInfo()); return true; }
      if (pathname === '/cloud/stop') { stopTunnel(); json(res, getInfo()); return true; }
      if (pathname === '/cloud/schedule') {
        try {
          const proposal = validateSchedule(await jsonBody(req));
          if (options.production) options.production.legacySchedule(proposal || { clear: true });
          else saveSchedule(proposal);
          schedule = proposal;
          json(res, { ok: true, schedule });
        } catch (error) { json(res, { error: error.message }, error.status || 400); }
        return true;
      }
      if (pathname === '/cloud/chat') {
        try {
          const body = await jsonBody(req);
          const text = normalizeChatText(body?.text);
          const to = body?.to === 'all' ? 'all' : Number(body?.to);
          if (to !== 'all' && (!Number.isInteger(to) || to < 1 || to > 8)) throw new Error('Target must be All or CAM 1 to 8.');
          const record = options.production ? options.production.legacyChat(to, text) : addMessage({ from: 'regie', to, text });
          json(res, { ok: true, message: record }, 201);
        } catch (error) { json(res, { error: error.message }, error.status || 400); }
        return true;
      }
    }
    if (req.method === 'GET' && (pathname === '/cloud' || pathname === '/cloud/')) {
      if (options.production) { res.writeHead(302, { Location: '/production' }); res.end(); }
      else html(res, adminPage);
      return true;
    }
    const openMatch = /^\/cloud\/open\/([1-8])$/.exec(pathname);
    if (req.method === 'GET' && openMatch && options.production) {
      if (!publicUrl) { json(res, { error: 'Tunnel not ready yet' }, 409); return true; }
      res.writeHead(302, { ...SECURITY_HEADERS, Location: options.production.link('camera' + openMatch[1], publicUrl) }); res.end(); return true;
    }
    if (req.method === 'GET' && pathname === '/cloud/info') { json(res, getInfo()); return true; }
    const qrMatch = /^\/cloud\/qr\/([1-8])$/.exec(pathname);
    if (req.method === 'GET' && qrMatch) {
      if (!publicUrl) { json(res, { error: 'Tunnel not ready yet' }, 409); return true; }
      try {
        const url = options.production ? options.production.link('camera' + qrMatch[1], publicUrl) : `${publicUrl}/tally/${Number(qrMatch[1])}`;
        const svg = await QRCode.toString(url, { type: 'svg', width: 160, margin: 1, errorCorrectionLevel: 'M' });
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'image/svg+xml' });
        res.end(svg);
      } catch (error) { json(res, { error: String(error) }, 500); }
      return true;
    }
    const pngMatch = /^\/cloud\/qr\/([1-8])\.png$/.exec(pathname);
    if (req.method === 'GET' && pngMatch) {
      if (!publicUrl) { json(res, { error: 'Tunnel not ready yet' }, 409); return true; }
      try {
        const url = options.production ? options.production.link('camera' + pngMatch[1], publicUrl) : `${publicUrl}/tally/${Number(pngMatch[1])}`;
        const buffer = await QRCode.toBuffer(url, { type: 'png', width: 230, margin: 1, errorCorrectionLevel: 'M' });
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'image/png' });
        res.end(buffer);
      } catch (error) { json(res, { error: String(error) }, 500); }
      return true;
    }
    json(res, { error: 'Not found' }, 404); return true;
  }
  return {
    tallyPort,
    handlePrivate,
    startTunnel,
    stop: () => { stopTunnel(); publicServer.close(); },
    getInfo
  };
}

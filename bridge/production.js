import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import { Presence, preflight } from './presence.js';
import { ProductionStore, ROLES } from './production-store.js';
import { acquireDataLock } from './data-lock.js';

const assets = fileURLToPath(new URL('./web/', import.meta.url));
const HEADERS = { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY', 'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
function send(res, value, code=200, type='application/json; charset=utf-8') {
  res.writeHead(code,{...HEADERS,'Content-Type':type}); res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
}
async function body(req,limit=900000) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('JSON required.'),{status:415});
  const chunks=[]; let size=0;
  for await (const chunk of req) { size+=chunk.length; if(size>limit) throw Object.assign(new Error('Request too large.'),{status:413}); chunks.push(chunk); }
  try { const result = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error(); return result; }
  catch { throw Object.assign(new Error('Invalid JSON.'),{status:400}); }
}
export function createProduction(getStatus, cameraStatus, options={}) {
  const file = options.file || process.env.PRODOS_DATA_PATH || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'.config'),'PRODOS',getStatus().demo?'demo-production.json':'production.json');
  const release = options.lock === false ? ()=>{} : acquireDataLock(file);
  let store;
  try { store = new ProductionStore(file); } catch(error) { release(); throw error; }
  let cloud;
  const rate = new Map();
  let presence=new Presence(),probe=null,probeBusy=false;
  let tunnelCheck={ok:false,checkedAt:null,detail:'Not checked yet',url:null};
  async function checkTunnel(){
    const url=cloud?.getInfo().publicUrl;
    if(probeBusy)return;
    probeBusy=true;
    try{
      if(!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url||''))throw Error('Quick Tunnel is not ready');
      probe={key:randomBytes(24).toString('hex'),until:Date.now()+5500};
      const response=await (options.fetch||fetch)(url+'/production/probe/'+probe.key,{signal:AbortSignal.timeout(5000),redirect:'error',cache:'no-store'});
      if(response.status!==204)throw Error('Unexpected tunnel response');
      tunnelCheck={ok:true,checkedAt:Date.now(),detail:'Public tunnel reachable',url};
    }catch(error){tunnelCheck={ok:false,checkedAt:Date.now(),detail:'Tunnel not verified: '+error.message,url};}
    finally{probe=null;probeBusy=false;}
  }
  const link = (role, base) => `${base}${role.startsWith('camera') ? '/tally/'+role.slice(6) : '/role/'+role}#${store.active.tokens[role]}`;
  const links = () => {
    const info = cloud?.getInfo();
    const base = info?.publicUrl || `http://127.0.0.1:${cloud?.tallyPort}`;
    return ROLES.map(role=>({role,url:link(role,base),local:!info?.publicUrl}));
  };
  function snapshot(role) {
    const status = getStatus();
    const out = store.view(role);
    out.demo = !!status.demo;
    if(role.startsWith('camera')) out.camera = cameraStatus(Number(role.slice(6)),status.state,status.connected);
    else {
      out.connected = status.connected;
      out.program = status.connected ? status.state?.video?.mixEffects?.[0]?.programInput ?? null : null;
      out.preview = status.connected ? status.state?.video?.mixEffects?.[0]?.previewInput ?? null : null;
      out.camera = cameraStatus(out.moderatorCamera,status.state,status.connected);
    }
    if(role==='regie') {
      const info = cloud?.getInfo();
      out.links = links(); out.cloud = {running: info?.cloudRunning || false,url:info?.publicUrl || null,error:info?.tunnelError || null,status:info?.tunnelStatus||'off',log:info?.tunnelLog||''};
      out.cameras = Array.from({length:8},(_,i)=>cameraStatus(i+1,status.state,status.connected));
      out.presence=presence.view(store.active.id,ROLES,store.active.requiredRoles);
      for(const p of out.presence){p.lastReply=store.active.messages.filter(m=>m.from===p.role).at(-1)?.at??null;}
      const currentCheck={...tunnelCheck,ok:tunnelCheck.ok&&tunnelCheck.url===info?.publicUrl};
      out.preflight=preflight(store.active,status,out.presence,currentCheck);
      out.tunnelCheck=currentCheck;
    }
    return out;
  }
  async function handle(req,res,isPrivate=false) {
    const url = new URL(req.url,'http://localhost'); const p = url.pathname;
    if(!p.startsWith('/production') && !/^\/role\/(redaktion|moderation)$/.test(p) && !/^\/tally\/[1-8]\/?$/.test(p)) return false;
    try {
      if(isPrivate && req.headers.host !== `127.0.0.1:${options.adminPort?.()}`) { send(res,{error:'Invalid host.'},403); return true; }
      if(isPrivate && req.headers.origin && req.headers.origin !== `http://127.0.0.1:${options.adminPort?.()}`) { send(res,{error:'Invalid origin.'},403); return true; }
      if(req.method==='GET' && p.startsWith('/production/probe/')){
        if(!isPrivate&&probe&&Date.now()<probe.until&&p==='/production/probe/'+probe.key){res.writeHead(204,HEADERS);res.end();}else send(res,{error:'Not found'},404);return true;
      }
      if(req.method==='GET' && ['/production/app.js','/production/style.css','/production/ui-state.js'].includes(p)) {
        send(res,readFileSync(path.join(assets,p.split('/').at(-1))),200,p.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'); return true;
      }
      if(req.method==='GET' && (p==='/production' || /^\/role\/(redaktion|moderation)$/.test(p) || /^\/tally\/[1-8]\/?$/.test(p))) {
        if(p==='/production' && !isPrivate) { send(res,{error:'Not found'},404); return true; }
        send(res,readFileSync(path.join(assets,'index.html')),200,'text/html; charset=utf-8'); return true;
      }
      const role = isPrivate ? 'regie' : store.authenticate(String(req.headers.authorization||'').replace(/^Bearer /,''));
      if(!role) {send(res,{error:'Invalid role link or show changed. Ask the director for a new QR code.'},401);return true;}
      if(req.method==='GET' && p==='/production/state') {presence.touch(store.active.id,role,req.headers['x-client-id'],req.headers['x-client-visibility']);send(res,snapshot(role)); return true; }
      if(p==='/production/export'&&isPrivate&&req.method==='GET'){
        res.writeHead(200,{...HEADERS,'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="PRODOS-Show.json"'});res.end(JSON.stringify(store.export(),null,2));return true;
      }
      if(p==='/production/preflight'&&isPrivate&&req.method==='POST'){await checkTunnel();send(res,snapshot(role));return true;}
      if(isPrivate && req.method==='GET' && p.startsWith('/production/qr/')) {
        const r = p.slice('/production/qr/'.length);
        if(!ROLES.includes(r)) {send(res,{error:'Unknown role'},404);return true;}
        const entry=links().find(x=>x.role===r);
        send(res,await QRCode.toString(entry.url,{type:'svg',width:180,margin:1}),200,'image/svg+xml'); return true;
      }
      if(req.method==='POST' && p==='/production/action') {
        if(!isPrivate) {
          const last = rate.get(role) || 0;
          if(Date.now()-last<200) {send(res,{error:'Please wait.'},429);return true;}
          rate.set(role,Date.now());
        }
        const data=await body(req,isPrivate?18*1024*1024:900000);
        const oldId=store.active.id;
        store.act(role,data.action,data);
        if(oldId!==store.active.id||data.action==='rotate')presence=new Presence();
        send(res,snapshot(role)); return true;
      }
      send(res,{error:'Not found'},404); return true;
    } catch(error) {send(res,{error:error.message},error.status||400);return true;}
  }
  return { store, link, snapshot, handle, close: release, owner: release.identity, setOwner: release.update, attach: c=>{cloud=c;},
    legacySchedule: proposal=>store.act('regie','schedule',{...proposal,showId:store.active.id}),
    legacyChat: (to,text)=> {store.act('regie','chat',{to:to==='all'?'team':'camera'+to,text,showId:store.active.id}); return legacyMessages().at(-1);},
    legacyMessages,
  };
  function legacyMessages() {return store.visibleMessages('regie').map(m=>({...m,from:m.from.startsWith('camera')?'camera':m.from,camera:m.from.startsWith('camera')?Number(m.from.slice(6)):undefined,to:m.to.startsWith('camera')?Number(m.to.slice(6)):m.to}));}
}

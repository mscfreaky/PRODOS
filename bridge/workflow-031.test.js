import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ProductionStore} from './production-store.js';
import {createTunnelProcess,explainTunnelError} from './tunnel-process.js';
function fixture(t){const dir=mkdtempSync(path.join(tmpdir(),'prodos031-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return new ProductionStore(path.join(dir,'show.json'));}
const act=(s,r,a,b={})=>s.act(r,a,{...b,showId:s.active.id});
test('team recipients are fixed at send time, excluded roles cannot read/ack, imports preserve team',t=>{
 const s=fixture(t);act(s,'regie','required',{roles:['moderation','camera3']});act(s,'regie','chat',{to:'team',text:'Team ready?'});const id=s.active.messages[0].id;
 assert.deepEqual(s.view('regie').messages[0].acknowledgements.expected,['moderation','camera3']);
 assert.equal(s.view('camera1').messages.length,0);assert.throws(()=>act(s,'camera1','ack',{id}));
 act(s,'regie','required',{roles:['camera1']});assert.equal(s.view('camera1').messages.length,0);
 act(s,'moderation','ack',{id});act(s,'camera3','ack',{id});assert.equal(s.view('regie').messages[0].acknowledged,true);
 const bundle=s.export();act(s,'regie','import',{bundle});assert.deepEqual(s.active.messages[0].recipients,['moderation','camera3']);
 act(s,'regie','chat',{to:'team',text:'New team'});assert.deepEqual(s.active.messages.at(-1).recipients,['camera1']);
 act(s,'regie','chat',{to:'camera8',text:'Direct contact'});assert.equal(s.view('camera8').messages.at(-1).text,'Direct contact');
});
test('moderation can move chapters; cameras remain forbidden; display names are visible',t=>{
 const s=fixture(t);act(s,'moderation','chapter.step',{step:1,expectedChapter:0});assert.equal(s.active.chapter,1);
 act(s,'moderation','chapter',{index:0});assert.equal(s.active.chapter,0);assert.throws(()=>act(s,'camera1','chapter',{index:1}));
 act(s,'regie','assign',{moderatorCamera:3,assignments:{camera3:'Operator'}});assert.equal(s.view('redaktion').roleNames.camera3,'Operator');
});
function fake(){const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.exitCode=null;p.kill=()=>{p.exitCode=1;p.emit('exit',1);};return p;}
test('tunnel URL alone is not ready; registered connection is ready; stop/restart ignores stale logs',()=>{
 const children=[];let args;const t=createTunnelProcess(()=> 'cloudflared',123,{spawnProcess:(c,a)=>{args=a;const p=fake();children.push(p);return p;}});
 t.start();assert.ok(args.includes('http2'));children[0].stderr.emit('data','https://example-test.trycloudflare.com\n');assert.equal(t.info().publicUrl,null);
 children[0].stderr.emit('data','Registered tunnel connection\n');assert.equal(t.info().publicUrl,'https://example-test.trycloudflare.com');
 t.start();assert.equal(children.length,1);t.stop();t.start();children[0].stderr.emit('data','Registered tunnel connection');assert.equal(t.info().publicUrl,null);t.stop();
});
test('DNS failure survives process exit, missing executable and timeout report actionable errors',async()=>{
 const children=[];const t=createTunnelProcess(()=> 'cloudflared',123,{timeoutMs:10,spawnProcess:()=>{const p=fake();children.push(p);return p;}});
 t.start();children[0].stderr.emit('data','failed to request quick Tunnel: lookup api.trycloudflare.com: no such host');children[0].emit('exit',1);
 assert.match(t.info().tunnelError,/DNS/);assert.match(t.info().tunnelLog,/api.trycloudflare.com/);assert.equal(t.info().tunnelStatus,'error');
 t.start();children[1].emit('error',{code:'ENOENT'});assert.match(t.info().tunnelError,/not found/);
 t.start();await new Promise(r=>setTimeout(r,25));assert.equal(t.info().cloudRunning,false);assert.equal(t.info().tunnelStatus,'error');t.stop();
 assert.match(explainTunnelError('x509 certificate'),/certificate/);
});

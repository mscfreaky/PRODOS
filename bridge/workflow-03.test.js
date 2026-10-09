import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {ProductionStore,ROLES} from './production-store.js';
import {Presence,preflight} from './presence.js';
import {LiveTransition,readerSettings,chapterTiming} from './web/ui-state.js';
import {createProduction} from './production.js';
import {createCloudTally,cameraStatus} from './cloud-tally.js';
import {makeDemoState} from './demo.js';
function fixture(t){const dir=mkdtempSync(path.join(tmpdir(),'prodos-03-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'production.json');return {dir,file,store:new ProductionStore(file)};}
function act(s,r,a,b={},now=Date.now()){return s.act(r,a,{...b,showId:s.active.id},now);}
test('0.2 data upgrades in place without replacing show, tokens, questions or messages',t=>{
  const {file,store}=fixture(t);const original=structuredClone(store.data);
  for(const s of original.shows){delete s.chapterDurations;delete s.chapterStartedAt;delete s.requiredRoles;}
  writeFileSync(file,JSON.stringify(original));const upgraded=new ProductionStore(file);
  assert.equal(upgraded.active.id,store.active.id);assert.deepEqual(upgraded.active.tokens,store.active.tokens);
  assert.deepEqual(upgraded.active.chapterDurations,[0,0,0]);assert.equal(upgraded.active.requiredRoles.length,10);
});
test('chapter arrows enforce rights, bounds and concurrent changes; durations survive reopen',t=>{
  const {file,store:s}=fixture(t);
  for(const role of ['camera3'])assert.throws(()=>act(s,role,'chapter.step',{step:1,expectedChapter:0}),e=>e.status===403);
  assert.throws(()=>act(s,'regie','chapter.step',{step:-1,expectedChapter:0}));
  act(s,'regie','rundown',{durations:[60,120,30]});act(s,'regie','start',{},100000);
  act(s,'redaktion','chapter.step',{step:1,expectedChapter:0},165000);
  assert.equal(s.active.chapterStartedAt,165000);
  assert.throws(()=>act(s,'regie','chapter.step',{step:1,expectedChapter:0}),e=>e.status===409);
  assert.deepEqual(new ProductionStore(file).active.chapterDurations,[60,120,30]);
  const timing=chapterTiming(s.view('regie',175000),175000);assert.equal(timing.remaining,110000);assert.equal(timing.delta,5000);
  act(s,'regie','chapter.step',{step:1,expectedChapter:1},190000);
  assert.throws(()=>act(s,'regie','chapter.step',{step:1,expectedChapter:2}));
});
test('broadcast confirmation names every missing role and remains per-recipient',t=>{
  const {store:s}=fixture(t);act(s,'regie','chat',{to:'all',text:'Stand by'});const id=s.active.messages[0].id;
  act(s,'camera1','ack',{id});act(s,'camera2','ack',{id});act(s,'camera2','ack',{id});
  const message=s.view('regie').messages[0];assert.equal(message.acknowledgements.expected.length,10);assert.deepEqual(message.acknowledgements.confirmed,['camera1','camera2']);
  assert.equal(message.acknowledgements.missing.length,8);assert.equal(message.acknowledged,false);
  assert.equal(s.view('camera1').messages[0].acknowledged,true);assert.equal(s.view('camera3').messages[0].acknowledged,false);assert.equal(s.view('camera1').messages[0].acknowledgements,undefined);
  for(const r of ROLES)act(s,r,'ack',{id});assert.equal(s.view('regie').messages[0].acknowledged,true);
});
test('portable export/import preserves content but creates new identity and secret links',t=>{
  const {store:s,file}=fixture(t);act(s,'regie','chat',{to:'camera3',text:'Test'});act(s,'camera3','ack',{id:s.active.messages[0].id});act(s,'redaktion','question.add',{text:'Question?'});
  act(s,'regie','rundown',{durations:[30,60,90]});act(s,'regie','required',{roles:['camera3']});act(s,'regie','start');
  const old=structuredClone(s.active),bundle=s.export();assert.equal(bundle.show.tokens,undefined);
  act(s,'regie','import',{bundle});assert.notEqual(s.active.id,old.id);assert.notDeepEqual(s.active.tokens,old.tokens);assert.equal(s.active.markdown,old.markdown);
  assert.deepEqual(s.active.chapterDurations,old.chapterDurations);assert.deepEqual(s.active.requiredRoles,old.requiredRoles);assert.equal(s.active.actualStart,old.actualStart);
  assert.notEqual(s.active.messages[0].id,old.messages[0].id);assert.equal(s.active.messages[1].ackFor,s.active.messages[0].id);assert.equal(s.data.shows.length,2);
  assert.equal(new ProductionStore(file).active.id,s.active.id);
});
test('invalid imports and unauthorized imports never mutate state; backups contain pre-change data',t=>{
  const {store:s,file}=fixture(t),before=readFileSync(file,'utf8');const malformed=s.export();malformed.show.moderatorCamera=99;
  assert.throws(()=>act(s,'regie','import',{bundle:malformed}));assert.equal(readFileSync(file,'utf8'),before);
  for(const r of ['redaktion','moderation','camera1'])assert.throws(()=>act(s,r,'import',{bundle:s.export()}),e=>e.status===403);
  const original=s.active.markdown;act(s,'regie','markdown',{text:'# New script'});
  const backups=readdirSync(file+'.backups');assert.equal(backups.length,1);assert.equal(JSON.parse(readFileSync(path.join(file+'.backups',backups[0]),'utf8')).shows[0].markdown,original);
});
test('presence separates never opened, foreground, background and missed heartbeat; show scopes isolate',()=>{
  const p=new Presence();assert.equal(p.view('a',['camera1'],[],100)[0].status,'never');
  p.touch('a','camera1','abcdefgh','visible',1000);assert.equal(p.view('a',['camera1'],[],2000)[0].status,'online');
  p.touch('a','camera1','abcdefgh','hidden',3000);assert.equal(p.view('a',['camera1'],[],4000)[0].status,'background');
  p.touch('a','camera1','second-tab','visible',4000);assert.equal(p.view('a',['camera1'],[],5000)[0].sessions,2);
  assert.equal(p.view('a',['camera1'],[],13000)[0].status,'offline');assert.equal(p.view('b',['camera1'],[],5000)[0].status,'never');
});
test('preflight never treats a demo or an old tunnel check as live readiness',t=>{
  const {store:s}=fixture(t);const checks=preflight(s.active,{connected:true,demo:true,state:makeDemoState()},[{role:'camera1',required:true,status:'offline'}],{ok:true,checkedAt:1,detail:'old'},100000);
  assert.equal(checks.find(c=>c.id==='atem').ok,false);assert.equal(checks.find(c=>c.id==='tunnel').ok,false);assert.equal(checks.find(c=>c.id==='roles').ok,false);
});
test('LIVE transition flashes once, never on first load, repeat polling, reconnect or camera reassignment',()=>{
  const t=new LiveTransition();assert.equal(t.update('show:3','program'),false);assert.equal(t.update('show:3','program'),false);
  assert.equal(t.update('show:3','preview'),false);assert.equal(t.update('show:3','program'),true);assert.equal(t.update('show:3','program'),false);
  t.disconnect();assert.equal(t.update('show:3','program'),false);assert.equal(t.update('show:4','program'),false);
  assert.equal(t.update('show:4','off'),false);assert.equal(t.update('show:4','program'),true);
});
test('reader defaults and validated local choices; partial chapter plans do not claim accuracy',()=>{
  assert.deepEqual(readerSettings(),{font:24,line:1.6,width:65,theme:'dark'});assert.equal(readerSettings({font:900,line:-1,theme:'evil'}).font,24);
  assert.equal(readerSettings({font:32,theme:'light'}).theme,'light');
  assert.equal(chapterTiming({chapter:1,chapterDurations:[0,60],chapterStartedAt:1000,actualStart:0,actualEnd:null},10000).delta,null);
});
test('new HTTP endpoints enforce role isolation and probe uses only current one-time challenge',async t=>{
  const {file}=fixture(t);let port=0,probeCalled=0;
  const production=createProduction(()=>({connected:true,demo:true,state:makeDemoState()}),cameraStatus,{file,adminPort:()=>port,fetch:async url=>{probeCalled++;assert.match(url,/^https:\/\/test\.trycloudflare\.com\/production\/probe\/[a-f0-9]{48}$/);const response=await fetch(pub+new URL(url).pathname);assert.equal(response.status,204);return response;}});
  const cloud=await createCloudTally(()=>({connected:true,demo:true,state:makeDemoState()}),{production,adminPort:()=>port});
  production.attach({...cloud,getInfo:()=>({...cloud.getInfo(),publicUrl:'https://test.trycloudflare.com'})});
  const server=http.createServer(async(req,res)=>{if(await production.handle(req,res,true))return;res.writeHead(404);res.end();});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));port=server.address().port;
  const admin=`http://127.0.0.1:${port}`,pub=`http://127.0.0.1:${cloud.tallyPort}`;t.after(async()=>{cloud.stop();production.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));});
  const headers={Authorization:'Bearer '+production.store.active.tokens.camera1,'X-Client-Id':'test-phone-1','X-Client-Visibility':'visible'};
  await fetch(pub+'/production/state',{headers});const state=await(await fetch(admin+'/production/state')).json();assert.equal(state.presence.find(p=>p.role==='camera1').status,'online');
  const camera=await(await fetch(pub+'/production/state',{headers})).json();assert.equal(camera.presence,undefined);assert.equal(camera.preflight,undefined);
  assert.equal((await fetch(pub+'/production/export',{headers})).status,404);assert.equal((await fetch(pub+'/production/preflight',{method:'POST',headers})).status,404);
  const exported=await(await fetch(admin+'/production/export')).json();assert.equal(exported.show.tokens,undefined);
  const checked=await(await fetch(admin+'/production/preflight',{method:'POST'})).json();assert.equal(probeCalled,1);assert.equal(checked.tunnelCheck.ok,true);
  assert.equal((await fetch(pub+'/production/probe/'+'a'.repeat(48))).status,404);
});

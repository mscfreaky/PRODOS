import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { ProductionStore, clockState, chapters } from './production-store.js';
import { createProduction } from './production.js';
import { createCloudTally, cameraStatus } from './cloud-tally.js';
import { makeDemoState } from './demo.js';
import { acquireDataLock } from './data-lock.js';

function fixture(t) {
  const dir=mkdtempSync(path.join(tmpdir(),'prodos-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'shows.json');return {file,store:new ProductionStore(file)};
}
function action(store,role,action,data={},time) {return store.act(role,action,{...data,showId:store.active.id},time);}
test('all show data survives reopening; create, load and duplicate isolate shows',t=>{
  let {file,store}=fixture(t);const first=store.active.id;
  action(store,'regie','rename',{name:'Show A'});
  action(store,'regie','schedule',{startAt:Date.now(),endAt:Date.now()+60000});
  action(store,'regie','markdown',{text:'# One\nText\n# Two'});
  action(store,'redaktion','chapter',{index:1});
  action(store,'redaktion','question.add',{text:'Question?'});
  action(store,'moderation','question.set',{id:store.active.questions[0].id,done:true});
  action(store,'regie','assign',{moderatorCamera:8,assignments:{moderation:'Alex'}});
  action(store,'regie','start');action(store,'regie','chat',{to:'moderation',text:'Here we go'});action(store,'regie','end');
  const saved=structuredClone(store.data);store=new ProductionStore(file);assert.deepEqual(store.data,saved);
  action(store,'regie','duplicate',{name:'Show B'});const second=store.active.id;
  assert.notEqual(first,second);assert.equal(store.active.actualStart,null);assert.equal(store.active.messages.length,0);
  assert.equal(store.active.questions[0].done,false);assert.equal(store.active.moderatorCamera,8);assert.equal(store.active.chapter,1);
  assert.notEqual(store.active.tokens.redaktion,saved.shows[0].tokens.redaktion);
  action(store,'regie','load',{id:first});assert.deepEqual(store.active.questions,saved.shows[0].questions);
  action(store,'regie','create',{name:'Show C'});assert.equal(store.data.shows.length,3);assert.equal(store.active.questions.length,0);
});
test('questions have two states, sort completed last, allow reactivation',t=>{
  const {store}=fixture(t);action(store,'redaktion','question.add',{text:'A'},1000);action(store,'redaktion','question.add',{text:'B'},2000);
  const a=store.active.questions[0].id;action(store,'moderation','question.set',{id:a,done:true});
  assert.deepEqual(store.view('moderation').questions.map(q=>q.text),['B','A']);
  action(store,'redaktion','question.set',{id:a,done:false});assert.deepEqual(store.view('moderation').questions.map(q=>q.text),['A','B']);
  assert.throws(()=>action(store,'redaktion','question.set',{id:a,done:'approved'}));
});
test('chapter permissions for Director and Editorial, no forced scrolling API',t=>{
  const {store}=fixture(t);action(store,'regie','chapter',{index:1});assert.equal(store.active.chapter,1);
  action(store,'redaktion','chapter',{index:2});assert.equal(store.view('moderation').chapter,2);
  for(const role of ['camera1'])assert.throws(()=>action(store,role,'chapter',{index:0}),{status:403});
  assert.throws(()=>action(store,'redaktion','chapter',{index:99}));
  assert.deepEqual(chapters('# A\n```\n# Not a chapter\n```\n## B'),['A','B']);
});
test('strict permissions and minimum disclosure for cameras',t=>{
  const {store}=fixture(t);
  for(const role of ['redaktion','moderation','camera1'])for(const cmd of ['load','create','assign','schedule','start','end','markdown','rotate'])assert.throws(()=>action(store,role,cmd),{status:403});
  assert.throws(()=>action(store,'moderation','question.add',{text:'bad'}),{status:403});
  assert.equal(store.view('camera1').markdown,undefined);assert.equal(store.view('camera1').questions,undefined);assert.equal(store.view('redaktion').tokens,undefined);assert.equal(store.view('redaktion').shows,undefined);
  assert.throws(()=>store.act('regie','rename',{showId:'old',name:'bad'}),{status:409});
});
test('planned clock, actual start/end, overrun and event history',t=>{
  const {store}=fixture(t),now=Date.now();action(store,'regie','schedule',{startAt:now+1000,endAt:now+11000},now);
  assert.equal(clockState(store.active,now).phase,'countdown');assert.equal(clockState(store.active,now+2000).phase,'waiting');
  assert.throws(()=>action(store,'regie','end',{},now),{status:409});
  action(store,'regie','start',{},now+3000);assert.equal(clockState(store.active,now+5000).elapsed,2000);
  assert.equal(clockState(store.active,now+12000).remaining,-1000);
  assert.throws(()=>action(store,'regie','start',{},now+5000),{status:409});
  action(store,'regie','end',{},now+13000);assert.equal(clockState(store.active,now+99999).elapsed,10000);
  action(store,'regie','reset',{},now+14000);assert.deepEqual(store.active.events.map(e=>e.type),['start','end','reset']);
});
test('targeted messages, broadcast, replies and idempotent acknowledgements persist',t=>{
  const {store,file}=fixture(t);action(store,'regie','chat',{to:'camera2',text:'Move closer please'});const id=store.active.messages[0].id;
  assert.equal(store.view('camera1').messages.length,0);assert.equal(store.view('camera2').messages.length,1);
  assert.throws(()=>action(store,'camera1','ack',{id}),{status:404});
  action(store,'camera2','ack',{id});action(store,'camera2','ack',{id});assert.equal(store.active.messages.length,2);
  assert.equal(store.view('camera2').messages[0].acknowledged,true);
  action(store,'camera2','chat',{to:'regie',text:'Ready'});assert.throws(()=>action(store,'camera2','chat',{to:'all',text:'Spoof'}),{status:403});
  action(store,'redaktion','chat',{to:'moderation',text:'New question'});assert.equal(store.view('camera2').messages.length,3);
  action(store,'moderation','ack',{id:store.active.messages.at(-1).id});assert.equal(store.view('redaktion').messages[0].acknowledged,true);
  action(store,'regie','chat',{to:'all',text:'One minute remaining'});assert.equal(store.view('camera1').messages.length,1);
  assert.deepEqual(new ProductionStore(file).active.messages,store.active.messages);
});
test('tokens rotate; inactive shows cannot authenticate',t=>{
  const {store}=fixture(t),token=store.active.tokens.redaktion;
  assert.equal(store.authenticate(token),'redaktion');action(store,'regie','rotate');assert.equal(store.authenticate(token),null);
  const next=store.active.tokens.moderation;action(store,'regie','create',{name:'Another show'});assert.equal(store.authenticate(next),null);
});
test('corrupt state fails closed without overwriting original',t=>{
  const {file}=fixture(t);writeFileSync(file,'BROKEN');assert.throws(()=>new ProductionStore(file));assert.equal(readFileSync(file,'utf8'),'BROKEN');
});
test('failed save rolls back in-memory action',t=>{
  const {store}=fixture(t),saved=structuredClone(store.data);store.persist=()=>{throw Error('disk full');};
  assert.throws(()=>action(store,'regie','rename',{name:'Unsaved'}));assert.deepEqual(store.data,saved);
});
test('single data owner blocks a second instance and releases cleanly',t=>{
  const {file}=fixture(t),release=acquireDataLock(file);
  assert.throws(()=>acquireDataLock(file),/already/);release();
  const releaseAgain=acquireDataLock(file);releaseAgain();
});
test('HTTP role workflow, tunnel endpoint isolation, missing ATEM and authentication',async t=>{
  const {file}=fixture(t);let connected=true,port=0;
  const getStatus=()=>({connected,state:makeDemoState(1,2),demo:true});
  const production=createProduction(getStatus,cameraStatus,{file,adminPort:()=>port});
  const cloud=await createCloudTally(getStatus,{production,adminPort:()=>port});production.attach(cloud);
  const server=http.createServer(async(req,res)=>{if(await production.handle(req,res,true))return;if(await cloud.handlePrivate(req,res))return;res.writeHead(404);res.end();});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));port=server.address().port;
  t.after(async()=>{cloud.stop();production.close();server.closeAllConnections();await new Promise(ok=>server.close(ok));});
  const admin=`http://127.0.0.1:${port}`,pub=`http://127.0.0.1:${cloud.tallyPort}`;
  const headers=role=>({Authorization:'Bearer '+production.store.active.tokens[role]});
  const post=(base,role,action,data={})=>fetch(base+'/production/action',{method:'POST',headers:{'Content-Type':'application/json',...(role==='regie'?{}:headers(role))},body:JSON.stringify({showId:production.store.active.id,action,...data})});
  assert.equal((await fetch(pub+'/production/state')).status,401);
  assert.equal((await fetch(pub+'/production/state',{headers:headers('camera1')})).status,200);
  for(const route of ['/production','/cloud','/cloud/info','/state','/tally/1/status','/tally/1/reply'])assert.equal((await fetch(pub+route)).status,404);
  assert.equal((await fetch(pub+'/production/qr/redaktion',{headers:headers('camera1')})).status,404);
  assert.equal((await post(pub,'redaktion','chapter',{index:1})).status,200);
  assert.equal((await post(pub,'moderation','chapter',{index:0})).status,200);
  assert.equal((await post(admin,'regie','chapter',{index:2})).status,200);
  let snapshot=await(await fetch(pub+'/production/state',{headers:headers('redaktion')})).json();assert.equal(snapshot.chapter,2);assert.equal(snapshot.links,undefined);
  const badHostStatus=await new Promise((resolve,reject)=>{http.get(admin+'/production/state',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});
  assert.equal(badHostStatus,403);
  assert.equal((await fetch(admin+'/production/action',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(admin+'/production/action',{method:'POST',body:'{}'})).status,415);
  connected=false;snapshot=await(await fetch(pub+'/production/state',{headers:headers('camera1')})).json();assert.equal(snapshot.camera.status,'offline');
  const link=production.link('camera1','https://example.trycloudflare.com');assert.match(link,/\/tally\/1#[a-f0-9]{48}$/);
  const qr=await fetch(admin+'/production/qr/redaktion');assert.equal(qr.status,200);assert.match(await qr.text(),/<svg/);
  assert.equal((await fetch(pub+'/role/redaktion')).status,200);
  const asset=await fetch(pub+'/production/app.js');assert.equal(asset.status,200);assert.match(asset.headers.get('content-security-policy'),/default-src 'none'/);
  assert.equal((await post(admin,'regie','chat',{to:'camera1',text:'Test'})).status,200);
  snapshot=await(await fetch(pub+'/production/state',{headers:headers('camera1')})).json();assert.equal(snapshot.messages[0].text,'Test');
});

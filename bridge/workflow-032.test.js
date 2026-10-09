import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ProductionStore,ROLES} from './production-store.js';
import {PushGate,receiptMark} from './web/ui-state.js';
function fixture(t){const dir=mkdtempSync(path.join(tmpdir(),'prodos032-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'show.json');return{file,s:new ProductionStore(file)};}
const act=(s,r,a,b={},now=Date.now())=>s.act(r,a,{...b,showId:s.active.id},now);
test('one understanding action produces zero/one/two checks, no fake receipts from monitoring roles',t=>{
 const {s}=fixture(t);act(s,'regie','required',{roles:['moderation','camera3']});act(s,'regie','chat',{to:'team',text:'Ready?'});const id=s.active.messages[0].id;
 assert.equal(receiptMark(s.view('regie').messages[0].receipt),'');assert.equal(s.view('moderation').messages[0].canAck,true);
 act(s,'moderation','ack',{id});assert.equal(receiptMark(s.view('regie').messages[0].receipt),'✓');assert.equal(s.view('moderation').messages[0].canAck,false);
 act(s,'moderation','ack',{id});assert.equal(s.active.messages.length,2);
 act(s,'camera3','ack',{id});assert.equal(receiptMark(s.view('regie').messages[0].receipt),'✓✓');
 act(s,'redaktion','chat',{to:'moderation',text:'Presenter only'});const direct=s.active.messages.at(-1).id;
 assert.throws(()=>act(s,'regie','ack',{id:direct}));assert.equal(s.view('regie').messages.at(-1).canAck,false);
});
test('push restricted to Director, reaches every tally despite required roles, expires and cannot replay after restart/import',t=>{
 const {s,file}=fixture(t);act(s,'regie','required',{roles:[]});
 for(const role of ROLES)assert.throws(()=>act(s,role,'push',{text:'Audio is off'},1000),e=>e.status===403);
 act(s,'regie','push',{text:'Audio is off'},1000);
 for(const role of ROLES){assert.equal(s.view(role,2000).pushNotice.text,'Audio is off');assert.equal(s.view(role,2000).messages.at(-1).channel,'push');}
 assert.throws(()=>act(s,'regie','push',{text:'Audio is going live'},2000),e=>e.status===429);
 assert.throws(()=>act(s,'moderation','ack',{id:s.active.messages.at(-1).id},2000));
 assert.equal(s.view('moderation',5000).pushNotice,null);assert.equal(new ProductionStore(file).view('moderation',2000).pushNotice,null);
 const bundle=s.export();act(s,'regie','import',{bundle},2000);assert.equal(s.active.messages.at(-1).channel,'push');assert.equal(s.view('moderation',2000).pushNotice,null);
 act(s,'regie','push',{text:'Audio is going live'},6000);act(s,'regie','duplicate',{name:'Copy'},6100);assert.equal(s.view('moderation',6100).pushNotice,null);
});
test('client push gate accepts once per event, rejects old and wrong-show events',()=>{
 const gate=new PushGate(),n={id:4,showId:'show',expiresAt:5000};assert.equal(gate.accept('show',n,2000),true);assert.equal(gate.accept('show',n,2500),false);
 assert.equal(gate.accept('show',{...n,id:5},5000),false);assert.equal(gate.accept('other',n,2000),false);
 assert.equal(gate.accept('other',{...n,id:6,showId:'other'},2000),true);
});

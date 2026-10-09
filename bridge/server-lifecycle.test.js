import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function start(file, extra=[]) {
  const child=spawn(process.execPath,['server.js','--demo',...extra],{cwd:fileURLToPath(new URL('.',import.meta.url)),env:{...process.env,PRODOS_DATA_PATH:file},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let log='';child.stderr.on('data',d=>{log+=d;});
  const port=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(Error('Bridge startup timeout: '+log));},10000);
    child.stdout.on('data',d=>{const match=/READY (\d+)/.exec(String(d));if(match){clearTimeout(timer);resolve(Number(match[1]));}});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('Bridge exit '+code+': '+log));});
    child.once('error',e=>{clearTimeout(timer);reject(e);});
  });
  return {child,base:`http://127.0.0.1:${port}`};
}
async function stop(child){if(child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}
test('real bridge lifecycle persists data, refuses wrong origins, recovers stale lock',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'prodos-process-'));let run;
  try {
    run=await start(path.join(dir,'production.json'));
    let state=await(await fetch(run.base+'/production/state')).json();const id=state.id;
    assert.equal((await fetch(run.base+'/state')).status,200);
    assert.equal((await fetch(run.base+'/cloud/start',{method:'POST',headers:{Origin:'https://evil.example'}})).status,403);
    const r=await fetch(run.base+'/production/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'rename',name:'Neustart-Test',showId:id})});assert.equal(r.status,200);
    const info=await(await fetch(run.base+'/production/state')).json();const cameraUrl=info.links.find(x=>x.role==='camera1').url;
    const pub=new URL(cameraUrl).origin;
    assert.equal((await fetch(pub+'/state')).status,404);
    assert.equal((await fetch(pub+'/cloud/start',{method:'POST'})).status,404);
    assert.equal((await fetch(pub+'/production/action',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    await stop(run.child);run=await start(path.join(dir,'production.json'));
    state=await(await fetch(run.base+'/production/state')).json();assert.equal(state.id,id);assert.equal(state.name,'Neustart-Test');
  } finally {if(run)await stop(run.child);rmSync(dir,{recursive:true,force:true});}
});

test('Inspector and browser demo reuse one owner; detach does not stop its server or alter data', async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'prodos-reuse-'));let owner, attached;
  try {
    const file=path.join(dir,'production.json');owner=await start(file);
    const before=await(await fetch(owner.base+'/production/state')).json();
    attached=await start(file,['--reuse-existing']);
    assert.equal(attached.base,owner.base);
    const response=await fetch(attached.base+'/production/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'rename',name:'Gemeinsame Demo',showId:before.id})});
    assert.equal(response.status,200);
    await stop(attached.child);attached=null;
    const after=await(await fetch(owner.base+'/production/state')).json();
    assert.equal(after.id,before.id);assert.equal(after.name,'Gemeinsame Demo');
    assert.equal((await fetch(owner.base+'/instance')).status,403);
    const publicBase=new URL(after.links[0].url).origin;
    assert.equal((await fetch(publicBase+'/instance')).status,404);
    await stop(owner.child);owner=null;
    owner=await start(file,['--reuse-existing']);
    assert.equal((await(await fetch(owner.base+'/production/state')).json()).name,'Gemeinsame Demo');
  } finally {if(attached)await stop(attached.child);if(owner)await stop(owner.child);rmSync(dir,{recursive:true,force:true});}
});

test('rapid stop/start cycle recovers stale PID locks without losing the show',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'prodos-restart-'));let run;
  try {
    const file=path.join(dir,'production.json');let id;
    for(let i=0;i<6;i++){
      run=await start(file,['--reuse-existing']);
      const state=await(await fetch(run.base+'/production/state')).json();
      if(id)assert.equal(state.id,id);else id=state.id;
      await stop(run.child);run=null;
    }
  } finally {if(run)await stop(run.child);rmSync(dir,{recursive:true,force:true});}
});

test('a live demo owner cannot be reused as a real ATEM connection',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'prodos-mode-'));let run;
  try {
    const file=path.join(dir,'production.json');run=await start(file);
    const child=spawn(process.execPath,['server.js','--host','127.0.0.1','--reuse-existing'],{cwd:fileURLToPath(new URL('.',import.meta.url)),env:{...process.env,PRODOS_DATA_PATH:file},stdio:['ignore','pipe','pipe'],windowsHide:true});
    let error='';child.stderr.on('data',d=>error+=d);
    const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Mode test timed out'));},10000);child.on('exit',c=>{clearTimeout(timer);resolve(c);});child.on('error',reject);});
    assert.equal(code,5);assert.match(error,/different mode/);
    assert.equal((await(await fetch(run.base+'/state')).json()).demo,true);
  } finally {if(run)await stop(run.child);rmSync(dir,{recursive:true,force:true});}
});

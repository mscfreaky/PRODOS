import { openSync, closeSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

// One owning bridge per data file. A crashed process can leave a stale PID lock.
export function acquireDataLock(file) {
  const lock=file+'.lock';mkdirSync(path.dirname(file),{recursive:true});
  let fd;
  try { fd=openSync(lock,'wx',0o600); }
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    let owner;try{const value=JSON.parse(readFileSync(lock,'utf8'));owner=typeof value==='number'?{pid:value}:value;}catch{throw Object.assign(new Error('Data store is locked. Check the running suite.'),{code:'EDATAINUSE'});}
    const pid=owner?.pid;
    if(!Number.isSafeInteger(pid)||pid<1)throw new Error('Invalid lock file. Close the suite and check the lock file: '+lock);
    try{process.kill(pid,0);throw Object.assign(new Error('A Production Suite is already running for this data store. Use the existing instance or close it first.'),{code:'EDATAINUSE',owner});}
    catch(e){if(e.code!=='ESRCH')throw e;}
    unlinkSync(lock);fd=openSync(lock,'wx',0o600);
  }
  let owner={pid:process.pid,nonce:randomUUID(),version:'1.0.0'};
  writeFileSync(fd,JSON.stringify(owner));closeSync(fd);
  let released=false;
  const release=()=>{if(released)return;released=true;try{if(JSON.parse(readFileSync(lock,'utf8')).nonce===owner.nonce)unlinkSync(lock);}catch{}process.removeListener('exit',release);};
  release.update=fields=>{owner={...owner,...fields};const temp=lock+'.'+owner.nonce+'.tmp';writeFileSync(temp,JSON.stringify(owner),{mode:0o600});renameSync(temp,lock);};
  release.identity=()=>({...owner});
  process.once('exit',release);return release;
}

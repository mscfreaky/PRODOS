import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ProductionStore,chapters} from './production-store.js';

test('new shows use the single English sample and export without role secrets',t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'prodos-public-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const s=new ProductionStore(path.join(dir,'data.json'));
  const sourceSample=new URL('../examples/Studio-show.md',import.meta.url);
  const sample=readFileSync(existsSync(sourceSample)?sourceSample:new URL('../../examples/Studio-show.md',import.meta.url),'utf8').replace(/\r\n/g,'\n');
  assert.equal(s.active.markdown,sample);
  assert.deepEqual(chapters(sample),['Welcome','Conversation','Closing']);
  assert.equal(s.active.name,'My first show');
  assert.equal(s.active.questions.length,0);assert.equal(s.active.messages.length,0);
  assert.equal(s.export().format,'PRODOS-show');assert.equal(s.export().show.tokens,undefined);
  const old=s.export();old.format='LEGACY-show';
  s.act('regie','import',{showId:s.active.id,bundle:old});
  assert.equal(s.active.markdown,sample);
  assert.equal(s.data.shows.length,2);
  const malformed=s.export();malformed.format='LEGACY-show';malformed.show.moderatorCamera=9;
  assert.throws(()=>s.act('regie','import',{showId:s.active.id,bundle:malformed}));
});

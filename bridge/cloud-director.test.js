import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
const folder = mkdtempSync(path.join(tmpdir(), 'atem-tally-test-'));
process.env.ATEM_TALLY_CONFIG_PATH = path.join(folder, 'show-clock.json');
const { createCloudTally, validateSchedule, normalizeChatText } = await import('./cloud-tally.js');

function request(base, route, data, extra = {}) {
  return fetch(base + route, data === undefined ? extra : {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...extra.headers },
    body: JSON.stringify(data)
  });
}

test('show-time validation and chat text constraints', () => {
  const now = Date.now();
  assert.deepEqual(validateSchedule({ startAt: now, endAt: now + 5400000 }), { startAt: now, endAt: now + 5400000 });
  assert.equal(validateSchedule({clear: true}), null);
  assert.throws(() => validateSchedule({startAt: now + 5000, endAt: now}), /Invalid/);
  assert.throws(() => validateSchedule({startAt: now, endAt: now + 40 * 3600000}), /Invalid/);
  assert.equal(normalizeChatText('  Hallo\nWelt  '), 'Hallo Welt');
  assert.throws(() => normalizeChatText('x'.repeat(241)), /240/);
  assert.throws(() => normalizeChatText('  '), /240/);
});

test('chat routing, replies, acknowledgement, clocks, isolation and persistence', async () => {
  const state = {inputs: {'1': {longName:'Guests'}, '2':{longName:'Wide shot'}}, video:{mixEffects:[{programInput:1,previewInput:2,upstreamKeyers:[]}], downstreamKeyers:[],superSources:[]}};
  const cloud = await createCloudTally(() => ({ state, connected: true, demo: true }), { adminPort: () => localPort });
  const adminServer = http.createServer((req,res)=>{cloud.handlePrivate(req,res).then(done=>{if(!done){res.statusCode=404;res.end('Not Found');}}).catch(()=>{res.statusCode=500;res.end('Internal Error');});});
  let localPort = 0;
  await new Promise(ok => adminServer.listen(0, '127.0.0.1',ok));
  localPort = adminServer.address().port;
  const admin = `http://127.0.0.1:${localPort}`, pub = `http://127.0.0.1:${cloud.tallyPort}`;
  try {
    const now = Date.now() + 60000;
    let r = await request(admin, '/cloud/schedule', {startAt: now, endAt: now+7200000});
    assert.equal(r.status,200);
    const one = await(await request(pub,'/tally/1/status')).json();
    assert.equal(one.schedule.startAt,now);
    assert.equal(one.status,'program');
    assert.ok(Math.abs(one.serverTime-Date.now())<5000);
    const bad = await request(admin,'/cloud/schedule',{startAt: now+10000,endAt: now});
    assert.equal(bad.status,400);
    assert.equal((await(await request(pub,'/tally/1/status')).json()).schedule.startAt,now);
    r = await request(admin,'/cloud/chat',{to:2,text:'Wide shot bitte weiter'});
    assert.equal(r.status,201);
    const targeted = (await r.json()).message;
    let cam1 = await(await request(pub,'/tally/1/status')).json();
    let cam2 = await(await request(pub,'/tally/2/status')).json();
    assert.equal(cam1.messages.length,0);
    assert.equal(cam2.messages[0].text,'Wide shot bitte weiter');
    r = await request(pub,'/tally/2/reply',{text:'Understood',ackFor:targeted.id});
    assert.equal(r.status,201);
    cam2 = await(await request(pub,'/tally/2/status')).json();
    assert.equal(cam2.messages[0].acknowledged,true);
    assert.equal(cam2.messages[1].from,'camera');
    assert.equal((await request(pub,'/tally/2/reply',{text:'nochmals',ackFor:targeted.id})).status,429);
    assert.equal((await request(pub,'/cloud/info')).status,404);
    assert.equal((await request(pub,'/state')).status,404);
    assert.equal((await request(pub,'/cloud/chat',{to:'all',text:'FORGED'})).status,404);
    assert.equal((await request(admin,'/cloud/chat',{to:'all',text:'FORGED'}, {headers:{Origin:'https://evil.example'}})).status,403);
    r = await request(admin,'/cloud/chat',{to:'all',text:'All cameras: 5 minutes to show start'});
    assert.equal(r.status,201);
    cam1 = await(await request(pub,'/tally/1/status')).json();
    cam2 = await(await request(pub,'/tally/2/status')).json();
    assert.equal(cam1.messages.at(-1).text,'All cameras: 5 minutes to show start');
    assert.equal(cam2.messages.at(-1).text,cam1.messages.at(-1).text);
    assert.equal((await request(pub,'/tally/1')).status,200);
    const page = await (await request(pub,'/tally/1')).text();
    assert.match(page,/SHOW STARTS IN/);
    assert.match(page,/UNDERSTOOD/);
    assert.match(page,/SHOW ENDS IN/);
    r = await request(admin,'/cloud/schedule',{clear:true});
    assert.equal(r.status,200);
    assert.equal((await(await request(pub,'/tally/2/status')).json()).schedule,null);
    // Persistence after clearing and setting afresh.
    await request(admin,'/cloud/schedule',{startAt:now,endAt:now+7200000});
  } finally {
    cloud.stop();
    await new Promise(ok=>adminServer.close(ok));
  }
  const cloud2 = await createCloudTally(() => ({state,connected:true,demo:true}));
  try { const info=cloud2.getInfo();assert.ok(info.schedule);assert.equal(info.schedule.endAt-info.schedule.startAt,7200000);}
  finally {cloud2.stop();rmSync(folder,{recursive:true,force:true});}
});

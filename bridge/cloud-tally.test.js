import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraStatus } from './cloud-tally.js';

const base = () => ({
  inputs: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, { longName: 'Camera ' + (i + 1) }])),
  video: { mixEffects: [{ programInput: 3, previewInput: 8, upstreamKeyers: [] }], superSources: [{ boxes: [] }], downstreamKeyers: [] }
});
test('camera 3 is red / camera 8 green / camera 1 off', () => {
  const s = base();
  assert.equal(cameraStatus(3, s, true).status, 'program');
  assert.equal(cameraStatus(8, s, true).status, 'preview');
  assert.equal(cameraStatus(1, s, true).status, 'off');
  assert.equal(cameraStatus(3, s, false).status, 'offline');
});
test('super source boxes visible on air are program', () => {
  const s = base();
  s.video.mixEffects[0].programInput = 6000;
  s.video.superSources[0].boxes = [{ enabled: true, source: 2 }, { enabled: true, source: 6 }, { enabled: false, source: 1 }];
  assert.equal(cameraStatus(2, s, true).status, 'program');
  assert.equal(cameraStatus(6, s, true).status, 'program');
  assert.equal(cameraStatus(1, s, true).status, 'off');
});
test('upstream keyers and downstream camera fills count as live', () => {
  const s = base();
  s.video.mixEffects[0].upstreamKeyers = [{ onAir: true, fillSource: 5 }];
  s.video.downstreamKeyers = [{ onAir: true, sources: { fillSource: 1 } }];
  assert.equal(cameraStatus(5, s, true).status, 'program');
  assert.equal(cameraStatus(1, s, true).status, 'program');
});
test('program wins over preview and name is retained', () => {
  const s = base();
  s.video.mixEffects[0].programInput = 8;
  assert.deepEqual(cameraStatus(8, s, true), { number: 8, name: 'Camera 8', status: 'program' });
});

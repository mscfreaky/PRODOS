import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemoState } from './demo.js';

test('demo state contains realistic inspector sections', () => {
  const state = makeDemoState(3, 2);
  assert.equal(state.video.mixEffects[0].programInput, 3);
  assert.equal(state.video.mixEffects[0].previewInput, 2);
  for (const key of ['inputs', 'video', 'fairlight', 'media', 'streaming', 'recording', 'macro', 'info']) {
    assert.ok(state[key]);
  }
  assert.doesNotThrow(() => JSON.stringify(state));
});

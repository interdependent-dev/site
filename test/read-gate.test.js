// Locks the canonical "finished read" behavior for the PORTAL copy of the gate.
// The API keeps an identical copy (interdependent-api/src/lib/readGate.js) with the
// SAME vectors in its own test — if you change one, change both, and both suites
// must stay green. Run: `npm test` (from site/).
const test = require('node:test');
const assert = require('node:assert');
const { isFinishedRead } = require('../lib/read-gate.js');

// [depth%, activeSeconds, pages, expectedFinished]
const CASES = [
  ['genuine full read of a feature',      96, 4000, 110, true],
  ['real read with heavy pauses',         92,  700, 110, true],
  ['fast-scroll skim to the bottom',     100,   20, 110, false],
  ['short script, fully read',            95,  300,  30, true],
  ['short script, skimmed',               95,   30,  30, false],
  ['unknown page count, real read',       90,  120, null, true],
  ['unknown page count, skim',           100,   20, null, false],
  ['stopped well short (depth too low)',  84, 9999, 110, false],
  ['exactly at the floor',                85,   90, null, true],
  ['one second under the floor',          85,   89, null, false],
];

for (const [name, depth, seconds, pages, expected] of CASES) {
  test(name, () => {
    assert.strictEqual(isFinishedRead(depth, seconds, pages), expected);
  });
}

test('handles missing/garbage inputs without throwing', () => {
  assert.strictEqual(isFinishedRead(undefined, undefined, undefined), false);
  assert.strictEqual(isFinishedRead(null, null, null), false);
});

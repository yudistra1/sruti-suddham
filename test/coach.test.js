import test from 'node:test';
import assert from 'node:assert/strict';

import { diagnose, findPatterns, liveAdvice } from '../src/coach.js';
import { CUTS } from '../src/tuning.js';

const attempt = (overrides = {}) => ({
  attempted: true,
  landed: true,
  centre: 0,
  wobble: 3,
  onset: 0,
  settle: 200,
  drift: 0,
  ...overrides,
});

const tagsOf = (result) => result.tags.map((tag) => tag.text);

/* ------------------------------------------------------------- live advice */

test('names the swara actually being sung when it is the wrong one', () => {
  // Target Pa (7), singing Sa (0) an octave up (12) — a fifth above.
  const advice = liveAdvice({ cents: 500, target: 7, singing: 12, wobble: 3 });
  assert.match(advice.headline, /^That is Sa/);
  assert.match(advice.headline, /not Pa$/);
  assert.equal(advice.tone, 'far');
});

test('calls out an octave error only when the swara itself is right', () => {
  const advice = liveAdvice({ cents: -1200, target: 12, singing: 0, wobble: 3 });
  assert.match(advice.headline, /octave/);
  assert.match(advice.detail, /higher/);
});

test('a wrong swara is not reported as an octave error', () => {
  const advice = liveAdvice({ cents: -700, target: 7, singing: 0, wobble: 3 });
  assert.doesNotMatch(advice.headline, /octave/);
  assert.match(advice.headline, /That is Sa/);
});

test('gives a direction and an amount when close but off', () => {
  const sharp = liveAdvice({ cents: 25, target: 1, singing: 1, wobble: 3 });
  assert.match(sharp.headline, /Ri1 is a shade sharp/);
  assert.match(sharp.detail, /Ease down/);

  const flat = liveAdvice({ cents: -45, target: 1, singing: 1, wobble: 3 });
  assert.match(flat.headline, /flat/);
  assert.match(flat.detail, /Lift up/);
});

test('separates being in tune from being steady', () => {
  const steady = liveAdvice({ cents: 4, target: 0, singing: 0, wobble: 4 });
  assert.equal(steady.headline, 'Hold it there');
  assert.equal(steady.tone, 'good');

  const shaky = liveAdvice({ cents: 4, target: 0, singing: 0, wobble: 22 });
  assert.match(shaky.headline, /wobbling/);
  assert.match(shaky.detail, /breath/);
  assert.equal(shaky.tone, 'near');
});

/* ---------------------------------------------------------------- diagnose */

test('a clean note gets no homework', () => {
  const result = diagnose(attempt(), 0);
  assert.deepEqual(tagsOf(result), ['centred', 'steady']);
  assert.match(result.note, /Clean/);
});

test('a scoop is named and measured', () => {
  const result = diagnose(attempt({ onset: -70 }), 0);
  assert.ok(tagsOf(result).includes('scooped up'));
  assert.match(result.note, /scooped up/);
  assert.match(result.note, /70/);
});

test('an onset from a completely different swara is not called a scoop', () => {
  // The singer was still on the previous note, not sliding into this one.
  const result = diagnose(attempt({ onset: -650 }), 0);
  assert.ok(!tagsOf(result).includes('scooped up'));
});

test('sagging is attributed to breath support', () => {
  const result = diagnose(attempt({ drift: -22 }), 0);
  assert.ok(tagsOf(result).includes('sagged'));
  assert.match(result.note, /support/);
});

test('a sharp Ga3 gets the guitar-ear explanation', () => {
  const result = diagnose(attempt({ centre: 16 }), 4);
  assert.match(result.note, /Guitar ear/);
  assert.match(result.note, /5:4/);
});

test('a sharp Ri1 is explained by how close it sits to Sa', () => {
  const result = diagnose(attempt({ centre: 18 }), 1);
  assert.match(result.note, /16:15/);
  assert.match(result.note, /closer to Sa/);
});

test('right pitch but never sustained is called out as sustain, not intonation', () => {
  const result = diagnose(attempt({ landed: false, centre: 4 }), 0);
  assert.ok(tagsOf(result).includes('never landed'));
  assert.match(result.note, /never held/i);
  assert.match(result.note, /sustain, not intonation/);
});

test('a wide persistent miss is called what it is', () => {
  const result = diagnose(attempt({ landed: false, centre: 60 }), 0);
  assert.match(result.note, /never got inside/);
  assert.match(result.note, /wide/);
});

test('an unsung swara says so instead of reporting zero cents', () => {
  const result = diagnose({ attempted: false, landed: false, centre: 0, wobble: 0, onset: 0, settle: 0, drift: 0 }, 0);
  assert.deepEqual(tagsOf(result), ['not sung']);
  assert.match(result.note, /Nothing came in/);
});

/* ---------------------------------------------------------------- patterns */

test('detects a consistent pull toward equal temperament', () => {
  const { steps } = CUTS.sarali;
  // Sharp on Ri1, Ga3, Dha1, Ni3; accurate everywhere else.
  const results = steps.map((semitone) => {
    const pitchClass = ((semitone % 12) + 12) % 12;
    const pulled = [1, 4, 8, 11].includes(pitchClass);
    return attempt({ centre: pulled ? 15 : 2 });
  });
  const findings = findPatterns(results, steps);
  assert.ok(findings.some((f) => /equal temperament/.test(f.headline)), 'should name the temperament pull');
});

test('detects overshooting up and undershooting down', () => {
  const { steps } = CUTS.sarali;
  const half = steps.length / 2;
  const results = steps.map((_, index) => attempt({ centre: index < half ? 14 : -14 }));
  const findings = findPatterns(results, steps);
  assert.ok(findings.some((f) => /overshoot/.test(f.headline)));
});

test('separates a wobble problem from an accuracy problem', () => {
  const { steps } = CUTS.sapasa;
  const results = steps.map(() => attempt({ centre: 2, wobble: 20 }));
  const findings = findPatterns(results, steps);
  assert.ok(findings.some((f) => /unsteady rather than wrong/.test(f.headline)));
});

test('says so when nothing is wrong', () => {
  const { steps } = CUTS.sapasa;
  const results = steps.map(() => attempt({ centre: 3 }));
  const findings = findPatterns(results, steps);
  assert.equal(findings.length, 1);
  assert.ok(findings[0].good);
});

test('always returns at least one finding, even for an empty run', () => {
  const { steps } = CUTS.sapasa;
  const results = steps.map(() => ({ attempted: false, landed: false, centre: 0, wobble: 0, onset: 0, settle: 0, drift: 0 }));
  const findings = findPatterns(results, steps);
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /Nothing was heard/);
});

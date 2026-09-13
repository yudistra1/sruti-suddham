import test from 'node:test';
import assert from 'node:assert/strict';

import { Drill, GIVE_UP_MS } from '../src/drill.js';
import { HOLD_MS, TOLERANCE_CENTS, summarise } from '../src/analysis.js';

const FRAME = 32; // ms, roughly one analysis frame at 60fps with a stride of 2

/**
 * Feed the drill a run of frames at a fixed offset from the target.
 * Returns the first advance the drill reported, if any.
 */
function sing(drill, cents, ms, clock = { now: 0 }) {
  let outcome = null;
  for (let elapsed = 0; elapsed < ms; elapsed += FRAME) {
    clock.now += FRAME;
    const result = drill.feedPitch(cents, FRAME, clock.now);
    if (result && !outcome) outcome = result;
  }
  return outcome;
}

function hush(drill, ms, clock = { now: 0 }) {
  let outcome = null;
  for (let elapsed = 0; elapsed < ms; elapsed += FRAME) {
    clock.now += FRAME;
    const result = drill.feedSilence(FRAME, clock.now);
    if (result && !outcome) outcome = result;
  }
  return outcome;
}

test('walks the cut in order', () => {
  const drill = new Drill('sapasa');
  assert.deepEqual(drill.steps, [0, 7, 12, 12, 7, 0]);
  assert.equal(drill.target, 0);
});

test('lands a swara once it has been held long enough', () => {
  const drill = new Drill('sapasa');
  const clock = { now: 0 };

  assert.equal(sing(drill, 3, HOLD_MS - 200, clock), null, 'should not land early');
  const outcome = sing(drill, 3, 400, clock);

  assert.ok(outcome);
  assert.equal(outcome.landed, true);
  assert.equal(outcome.swara, 0);
  assert.equal(drill.index, 1);
  assert.equal(drill.target, 7);
  assert.equal(drill.landedCount, 1);
});

test('a note that slips out of the band has to start its hold again', () => {
  const drill = new Drill('sapasa');
  const clock = { now: 0 };

  sing(drill, 3, HOLD_MS - 200, clock);
  sing(drill, 40, 400, clock);          // out of tune long enough to break the phrase
  assert.equal(drill.index, 0, 'should not have advanced');

  sing(drill, 3, HOLD_MS - 200, clock);
  assert.equal(drill.index, 0, 'the hold should have restarted, not resumed');
});

test('a brief wobble out of the band does not reset the hold', () => {
  const drill = new Drill('sapasa');
  const clock = { now: 0 };

  sing(drill, 3, 600, clock);
  sing(drill, TOLERANCE_CENTS + 5, 96, clock); // under the phrase-break threshold
  const outcome = sing(drill, 3, 400, clock);

  assert.ok(outcome, 'a momentary slip should be forgiven');
  assert.equal(outcome.landed, true);
});

test('gives up on a swara that never comes in tune', () => {
  const drill = new Drill('sapasa');
  const clock = { now: 0 };

  const outcome = sing(drill, 45, GIVE_UP_MS + FRAME * 2, clock);

  assert.ok(outcome);
  assert.equal(outcome.landed, false);
  assert.equal(drill.index, 1);
  assert.equal(drill.landedCount, 0);

  const [stats] = drill.results;
  assert.equal(stats.attempted, true);
  assert.equal(stats.landed, false);
  assert.ok(Math.abs(stats.centre - 45) < 1, `centre was ${stats.centre}`);
});

test('a swara nobody sang is recorded as unattempted', () => {
  const drill = new Drill('sapasa');
  const clock = { now: 0 };

  // Enough readings to trip the give-up check, then nothing but silence.
  sing(drill, 20, FRAME * 5, clock);
  drill.skip(clock.now);

  assert.equal(drill.results[0].attempted, true);

  drill.skip(clock.now);
  assert.equal(drill.results[1].attempted, false, 'no readings means no attempt');
});

test('skipping advances and records a miss', () => {
  const drill = new Drill('sapasa');
  const outcome = drill.skip(0);

  assert.equal(outcome.landed, false);
  assert.equal(drill.index, 1);
  assert.equal(drill.results.length, 1);
});

test('finishes after the last step and stops accepting input', () => {
  const drill = new Drill('sapasa');
  for (let i = 0; i < drill.steps.length; i += 1) drill.skip(i);

  assert.equal(drill.finished, true);
  assert.equal(drill.results.length, 6);
  assert.equal(drill.feedPitch(0, FRAME, 0), null);
  assert.equal(drill.skip(0), null);
});

test('silence eventually moves the drill along', () => {
  const drill = new Drill('sapasa');
  const clock = { now: 0 };

  sing(drill, 30, FRAME * 6, clock);
  const outcome = hush(drill, GIVE_UP_MS, clock);

  assert.ok(outcome);
  assert.equal(outcome.landed, false);
});

test('reset returns the drill to the top of the cut', () => {
  const drill = new Drill('sarali');
  drill.skip(0);
  drill.skip(0);
  drill.reset();

  assert.equal(drill.index, 0);
  assert.equal(drill.results.length, 0);
  assert.equal(drill.finished, false);
});

/* --------------------------------------------------------------- analysis */

test('summarise measures centre, wobble, onset and drift separately', () => {
  // A note that starts 60c flat, settles near the target, then sags away.
  const holdTrace = [];
  for (let i = 0; i < 40; i += 1) {
    const t = i * 25;
    const c = i < 3 ? -60 : 5 - i * 0.3;
    holdTrace.push({ t, c });
  }
  const now = holdTrace[holdTrace.length - 1].t;
  const stats = summarise({ landed: true, now, holdTrace, stepTrace: holdTrace });

  assert.equal(stats.attempted, true);
  assert.ok(stats.onset < -50, 'onset should show the scoop');
  assert.ok(stats.drift < -5, 'drift should show the sag');
  assert.ok(stats.settle > 0, 'settle should record how long it took to arrive');
});

test('summarise ignores a different swara sung during a missed attempt', () => {
  const stepTrace = [];
  // Half the attempt was spent on a swara a fourth away; it should not be
  // averaged into the centre for this one.
  for (let i = 0; i < 10; i += 1) stepTrace.push({ t: i * 25, c: 500 });
  for (let i = 10; i < 25; i += 1) stepTrace.push({ t: i * 25, c: 30 });

  const stats = summarise({ landed: false, now: 625, holdTrace: [], stepTrace });
  assert.ok(Math.abs(stats.centre - 30) < 1, `centre was ${stats.centre}`);
});

test('summarise refuses to report on too few readings', () => {
  const stats = summarise({ landed: false, now: 0, holdTrace: [], stepTrace: [{ t: 0, c: 5 }] });
  assert.equal(stats.attempted, false);
});

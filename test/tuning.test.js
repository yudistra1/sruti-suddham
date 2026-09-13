import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CUTS, DEFAULT_TONIC, MAYAMALAVAGOWLA, NOTE_NAMES, TONIC_OCTAVES,
  centsAboveSa, centsBetween, describe, frequencyOf, getTonic, htmlLabelOf,
  labelOf, nearestSwarasthana, noteLabel, noteToHz, ratioLabel, sameSwara,
  setTonic, tonicHz,
} from '../src/tuning.js';

/** The tonic is module state, so any test that moves it puts it back. */
const withTonic = (note, octave, body) => {
  const previous = getTonic();
  try {
    setTonic(note, octave);
    body();
  } finally {
    setTonic(previous.note, previous.octave);
  }
};

const closeTo = (actual, expected, tolerance, message) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message || `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

test('Sa is the tonic and the upper Sa is exactly an octave up', () => {
  assert.equal(frequencyOf(0), tonicHz());
  assert.equal(frequencyOf(12), tonicHz() * 2);
  assert.equal(frequencyOf(-12), tonicHz() / 2);
});

test('just intonation puts Pa at a 3:2 and Ga3 at a 5:4', () => {
  closeTo(frequencyOf(7) / tonicHz(), 1.5, 1e-12);
  closeTo(frequencyOf(4) / tonicHz(), 1.25, 1e-12);
});

test('the just targets a fretted ear gets wrong sit below the equal-tempered ones', () => {
  // These four gaps are the whole reason the tool defaults to just intonation.
  closeTo(centsAboveSa(4, 'just'), 386.3, 0.1);   // Ga3, ~14c under a fret
  closeTo(centsAboveSa(11, 'just'), 1088.3, 0.1); // Ni3, ~12c under
  closeTo(centsAboveSa(1, 'just'), 111.7, 0.1);   // Ri1, ~12c over
  closeTo(centsAboveSa(8, 'just'), 813.7, 0.1);   // Dha1, ~14c over
});

test('equal temperament is a clean 100 cents per semitone', () => {
  for (let semitone = 0; semitone < 12; semitone += 1) {
    closeTo(centsAboveSa(semitone, 'equal'), semitone * 100, 1e-9);
  }
});

test('centsBetween is signed and symmetric', () => {
  closeTo(centsBetween(tonicHz() * 2, tonicHz()), 1200, 1e-9);
  closeTo(centsBetween(tonicHz(), tonicHz() * 2), -1200, 1e-9);
  assert.equal(centsBetween(tonicHz(), tonicHz()), 0);
});

test('nearestSwarasthana resolves against the true targets, not the tempered grid', () => {
  // A perfect just Ga3 is 14c flat of the equal-tempered one. Rounding on the
  // tempered grid alone would still find semitone 4, so the interesting case is
  // a pitch that sits between the two conventions.
  assert.equal(nearestSwarasthana(frequencyOf(4, 'just'), 'just'), 4);
  assert.equal(nearestSwarasthana(frequencyOf(7, 'just'), 'just'), 7);
  assert.equal(nearestSwarasthana(tonicHz() * 2, 'just'), 12);
  assert.equal(nearestSwarasthana(tonicHz() / 2, 'just'), -12);
});

test('nearestSwarasthana picks the closer of two neighbours', () => {
  const between = Math.sqrt(frequencyOf(4) * frequencyOf(5)); // halfway, in cents
  const slightlyLow = between * 0.999;
  const slightlyHigh = between * 1.001;
  assert.equal(nearestSwarasthana(slightlyLow), 4);
  assert.equal(nearestSwarasthana(slightlyHigh), 5);
});

test('swaras are named with variant numbers and octave dots', () => {
  assert.equal(labelOf(0), 'Sa');
  assert.equal(labelOf(1), 'Ri1');
  assert.equal(labelOf(4), 'Ga3');
  assert.equal(labelOf(7), 'Pa');
  assert.equal(labelOf(12), 'Sȧ');   // taara sthayi: dot above
  assert.equal(labelOf(-1), 'Nị3');  // mandra sthayi: dot below, on the letter
  assert.equal(htmlLabelOf(1), 'Ri<sub>1</sub>');
  assert.equal(htmlLabelOf(0), 'Sa');
});

test('ratio labels read as ratios in just intonation and cents in equal', () => {
  assert.equal(ratioLabel(4, 'just'), '5:4');
  assert.equal(ratioLabel(12, 'just'), '2 : 1');
  assert.equal(ratioLabel(4, 'equal'), '400¢ ET');
});

test('sameSwara ignores octave', () => {
  assert.ok(sameSwara(0, 12));
  assert.ok(sameSwara(7, -5));
  assert.ok(!sameSwara(0, 7));
});

test('Mayamalavagowla has the symmetric tetrachords it is taught for', () => {
  assert.deepEqual(MAYAMALAVAGOWLA, [0, 1, 4, 5, 7, 8, 11, 12]);
  const lower = MAYAMALAVAGOWLA.slice(0, 4).map((s) => s - 0);
  const upper = MAYAMALAVAGOWLA.slice(4).map((s) => s - 7);
  assert.deepEqual(lower, upper, 'both tetrachords should have the same shape');
});

test('cuts ascend then descend over the same swaras', () => {
  for (const cut of Object.values(CUTS)) {
    const half = cut.steps.length / 2;
    assert.equal(half % 1, 0, `${cut.id} should have an even number of steps`);
    const up = cut.steps.slice(0, half);
    const down = cut.steps.slice(half);
    assert.deepEqual(down, up.slice().reverse());
  }
});

test('describe reports the pitch class and octave separately', () => {
  assert.equal(describe(13).pitchClass, 1);
  assert.equal(describe(13).octave, 1);
  assert.equal(describe(-11).pitchClass, 1);
  assert.equal(describe(-11).octave, -1);
});

/* -------------------------------------------------------------- the tonic */

test('note names resolve to concert pitch', () => {
  closeTo(noteToHz('A', 4), 440, 1e-9);
  closeTo(noteToHz('A', 3), 220, 1e-9);
  closeTo(noteToHz('C', 4), 261.6256, 0.001);
  closeTo(noteToHz('A#', 3), 233.0819, 0.001);
  closeTo(noteToHz('G', 4), 391.9954, 0.001);
});

test('every offered tonic is a real note', () => {
  for (const note of NOTE_NAMES) {
    for (const octave of TONIC_OCTAVES) {
      const hz = noteToHz(note, octave);
      assert.ok(Number.isFinite(hz) && hz > 0, `${note}${octave} gave ${hz}`);
    }
  }
  assert.throws(() => noteToHz('H', 4), /unknown note/);
});

test('the default tonic is A#3', () => {
  assert.deepEqual(DEFAULT_TONIC, { note: 'A#', octave: 3 });
  closeTo(tonicHz(), 233.0819, 0.001);
});

test('changing the tonic retunes every target', () => {
  withTonic('C', 4, () => {
    closeTo(tonicHz(), 261.6256, 0.001);
    closeTo(frequencyOf(0), 261.6256, 0.001);
    closeTo(frequencyOf(7), 261.6256 * 1.5, 0.001);   // Pa stays a just fifth
    closeTo(frequencyOf(12), 261.6256 * 2, 0.001);    // upper Sa stays an octave
  });
  // and it is restored afterwards
  closeTo(tonicHz(), 233.0819, 0.001);
});

test('the ratios themselves do not depend on the tonic', () => {
  const atDefault = [0, 1, 4, 5, 7, 8, 11, 12].map((s) => frequencyOf(s) / tonicHz());
  withTonic('G', 4, () => {
    const atG = [0, 1, 4, 5, 7, 8, 11, 12].map((s) => frequencyOf(s) / tonicHz());
    atG.forEach((ratio, i) => closeTo(ratio, atDefault[i], 1e-12));
  });
});

test('nearest swarasthana follows the tonic', () => {
  withTonic('C', 4, () => {
    assert.equal(nearestSwarasthana(261.63), 0);          // C4 is Sa
    assert.equal(nearestSwarasthana(261.63 * 1.5), 7);    // its fifth is Pa
    assert.equal(nearestSwarasthana(233.08), -2);         // A#3 is now below Sa
  });
});

test('tonic labels use a real sharp glyph', () => {
  assert.equal(noteLabel('A#', 3), 'A\u266F3');
  assert.equal(noteLabel('C', 4), 'C4');
});

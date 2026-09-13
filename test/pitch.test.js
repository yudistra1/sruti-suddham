import test from 'node:test';
import assert from 'node:assert/strict';

import { PitchDetector } from '../src/pitch.js';
import { centsBetween } from '../src/tuning.js';

const SAMPLE_RATE = 44100;

/**
 * A crude vowel: a fundamental plus a decaying harmonic series, optionally with
 * the fundamental itself attenuated. Real sung vowels often have far more energy
 * in the second and third harmonics than in the fundamental, which is exactly
 * the situation that makes naive autocorrelation report an octave error.
 */
function tone(frequency, { seconds = 0.2, harmonics = 6, fundamentalGain = 1, vibrato = 0 } = {}) {
  const length = Math.floor(SAMPLE_RATE * seconds);
  const samples = new Float32Array(length);
  let phase = 0;
  for (let i = 0; i < length; i += 1) {
    const t = i / SAMPLE_RATE;
    const bend = vibrato ? Math.pow(2, (vibrato * Math.sin(2 * Math.PI * 5 * t)) / 1200) : 1;
    phase += (2 * Math.PI * frequency * bend) / SAMPLE_RATE;
    let value = fundamentalGain * Math.sin(phase);
    for (let h = 2; h <= harmonics; h += 1) value += Math.sin(h * phase) / h;
    samples[i] = value * 0.25;
  }
  return samples;
}

function detectorFor(samples) {
  const detector = new PitchDetector(SAMPLE_RATE);
  assert.ok(samples.length >= detector.requiredSamples, 'test signal is too short');
  return detector;
}

test('recovers a sung pitch to within a cent', () => {
  for (const frequency of [116.54, 174.61, 233.08, 349.62, 466.16, 698.46]) {
    const samples = tone(frequency);
    const detector = detectorFor(samples);
    const reading = detector.detect(samples);
    assert.ok(reading, `nothing detected at ${frequency} Hz`);
    const error = Math.abs(centsBetween(reading.frequency, frequency));
    assert.ok(error < 1, `${frequency} Hz read as ${reading.frequency.toFixed(2)} Hz (${error.toFixed(2)}c off)`);
  }
});

test('does not drop an octave when the fundamental is weak', () => {
  // A missing-fundamental signal is where the first-peak rule earns its keep.
  const samples = tone(233.08, { fundamentalGain: 0.15, harmonics: 8 });
  const detector = detectorFor(samples);
  const reading = detector.detect(samples);
  assert.ok(reading);
  const error = Math.abs(centsBetween(reading.frequency, 233.08));
  assert.ok(error < 10, `read ${reading.frequency.toFixed(2)} Hz, ${error.toFixed(1)}c from the fundamental`);
});

test('tracks a vibrato tone near its centre', () => {
  const samples = tone(233.08, { vibrato: 30, seconds: 0.3 });
  const detector = detectorFor(samples);
  const reading = detector.detect(samples);
  assert.ok(reading);
  assert.ok(Math.abs(centsBetween(reading.frequency, 233.08)) < 35);
});

test('reports nothing for silence', () => {
  const samples = new Float32Array(4096);
  const detector = detectorFor(samples);
  assert.equal(detector.detect(samples), null);
  assert.equal(detector.rms, 0);
});

test('reports nothing for a signal below the silence floor', () => {
  const samples = tone(233.08);
  for (let i = 0; i < samples.length; i += 1) samples[i] *= 0.005;
  const detector = detectorFor(samples);
  assert.equal(detector.detect(samples), null);
});

test('rejects broadband noise rather than inventing a pitch', () => {
  const samples = new Float32Array(4096);
  let seed = 12345;
  for (let i = 0; i < samples.length; i += 1) {
    // Deterministic LCG, so a failure here is reproducible.
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    samples[i] = (seed / 0x3fffffff - 1) * 0.3;
  }
  const detector = detectorFor(samples);
  const reading = detector.detect(samples);
  assert.ok(reading === null || reading.clarity < 0.8, 'noise should not read as a confident pitch');
});

test('clarity is high for a clean tone', () => {
  const samples = tone(233.08);
  const detector = detectorFor(samples);
  const reading = detector.detect(samples);
  assert.ok(reading.clarity > 0.9, `clarity was ${reading.clarity.toFixed(3)}`);
});

test('the analysis window covers the lowest pitch it claims to detect', () => {
  const detector = new PitchDetector(SAMPLE_RATE);
  const lowest = SAMPLE_RATE / detector.maxLag;
  assert.ok(lowest <= 66, `lowest detectable pitch is ${lowest.toFixed(1)} Hz`);
});

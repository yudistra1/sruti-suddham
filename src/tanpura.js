/**
 * A four-string tanpura, synthesised rather than sampled so it never seams.
 *
 * Each pluck is a Karplus-Strong string rendered offline into an AudioBuffer:
 * a short burst of filtered noise pushed through a delay line whose feedback
 * path averages adjacent samples. The averaging is a one-zero lowpass, so
 * partials die off faster the higher they are, which is roughly what a real
 * string does.
 *
 * Two layers three cents apart stand in for jvari, the shimmer a tanpura's
 * bridge produces. It is cheap and it is the difference between "drone" and
 * "tanpura".
 */

import { TONIC_HZ } from './tuning.js';

const PLUCK_INTERVAL = 1.05;   // seconds between strings
const SCHEDULE_AHEAD = 1.2;    // seconds of lookahead
const TICK_MS = 260;           // how often the scheduler tops up
const DAMPING = 0.99997;       // per-sample; ~4s to inaudible at the fundamental
const MAX_GAIN = 0.3;

function renderString(context, frequency, seconds) {
  const { sampleRate } = context;
  const length = Math.floor(sampleRate * seconds);
  const mix = new Float32Array(length);
  const layers = [
    { frequency, gain: 1 },
    { frequency: frequency * Math.pow(2, 3 / 1200), gain: 0.34 },
  ];

  for (const layer of layers) {
    const period = Math.max(2, Math.round(sampleRate / layer.frequency));
    const line = new Float32Array(length);

    // Excitation: noise, gently lowpassed so the attack is a pluck and not a click.
    let smoothed = 0;
    let sum = 0;
    for (let i = 0; i < period; i += 1) {
      smoothed = smoothed * 0.55 + (Math.random() * 2 - 1) * 0.45;
      line[i] = smoothed;
      sum += smoothed;
    }
    // Remove DC, or the string starts with an audible thump.
    const mean = sum / period;
    for (let i = 0; i < period; i += 1) line[i] -= mean;

    let previous = 0;
    for (let i = period; i < length; i += 1) {
      const averaged = 0.5 * (line[i - period] + line[i - period + 1]);
      previous = previous * 0.28 + averaged * 0.72;
      line[i] = previous * DAMPING;
    }

    for (let i = 0; i < length; i += 1) mix[i] += line[i] * layer.gain;
  }

  // 4ms in, long fade out over the tail, so consecutive plucks never click.
  const attack = Math.floor(sampleRate * 0.004);
  const releaseFrom = Math.floor(length * 0.72);
  for (let i = 0; i < attack; i += 1) mix[i] *= i / attack;
  for (let i = releaseFrom; i < length; i += 1) {
    mix[i] *= 1 - (i - releaseFrom) / (length - releaseFrom);
  }

  const buffer = context.createBuffer(1, length, sampleRate);
  buffer.getChannelData(0).set(mix);
  return buffer;
}

export class Tanpura {
  /**
   * @param {AudioContext} context
   * @param {{temperament?: string, volume?: number}} options
   */
  constructor(context, options = {}) {
    this.context = context;
    this.temperament = options.temperament || 'just';
    this.volume = options.volume ?? 0.45;
    this.playing = false;
    this.strings = null;
    this.output = null;
    this.timer = null;
    this.step = 0;
    this.nextPluck = 0;
  }

  /** Classic tuning: Pa a fifth below Sa, two Sa, then Sa an octave down. */
  build() {
    const fifth = this.temperament === 'just' ? 3 / 2 : Math.pow(2, 7 / 12);
    this.strings = [
      renderString(this.context, (TONIC_HZ * fifth) / 2, 5),
      renderString(this.context, TONIC_HZ, 5),
      renderString(this.context, TONIC_HZ, 5),
      renderString(this.context, TONIC_HZ / 2, 6),
    ];
  }

  schedule() {
    const { context } = this;
    while (this.nextPluck < context.currentTime + SCHEDULE_AHEAD) {
      const source = context.createBufferSource();
      source.buffer = this.strings[this.step % 4];
      const gain = context.createGain();
      // The low Sa sits back a touch so the cycle does not lurch.
      gain.gain.value = this.step % 4 === 3 ? 0.85 : 1;
      source.connect(gain);
      gain.connect(this.output);
      source.start(Math.max(this.nextPluck, context.currentTime + 0.02));
      this.nextPluck += PLUCK_INTERVAL;
      this.step += 1;
    }
  }

  start() {
    if (this.playing) return;
    if (!this.strings) this.build();

    const { context } = this;
    this.output = context.createGain();
    this.output.gain.value = this.volume * MAX_GAIN;

    const tone = context.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 4200;
    tone.Q.value = 0.4;

    this.output.connect(tone);
    tone.connect(context.destination);

    this.step = 0;
    this.nextPluck = context.currentTime + 0.06;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.playing = true;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.output) {
      const node = this.output;
      // Ring the drone down rather than cutting it, then release the node once
      // every scheduled pluck has certainly finished.
      try {
        node.gain.setTargetAtTime(0, this.context.currentTime, 0.25);
      } catch {
        node.gain.value = 0;
      }
      setTimeout(() => {
        try { node.disconnect(); } catch { /* already gone */ }
      }, 1400);
      this.output = null;
    }
    this.playing = false;
  }

  setVolume(value) {
    this.volume = value;
    if (this.output) this.output.gain.value = value * MAX_GAIN;
  }

  /** Retuning means re-rendering the strings, so restart if we are mid-drone. */
  setTemperament(temperament) {
    if (temperament === this.temperament) return;
    this.temperament = temperament;
    this.strings = null;
    if (this.playing) {
      this.stop();
      this.start();
    }
  }
}

/**
 * A short reference tone for the target swara. Triangle plus an octave sine —
 * enough harmonic content to pitch against, soft enough not to startle.
 */
export function soundSwara(context, frequency) {
  const envelope = context.createGain();
  envelope.gain.value = 0;

  const fundamental = context.createOscillator();
  fundamental.type = 'triangle';
  fundamental.frequency.value = frequency;

  const octave = context.createOscillator();
  octave.type = 'sine';
  octave.frequency.value = frequency * 2;

  const octaveGain = context.createGain();
  octaveGain.gain.value = 0.22;

  fundamental.connect(envelope);
  octave.connect(octaveGain);
  octaveGain.connect(envelope);
  envelope.connect(context.destination);

  const now = context.currentTime;
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(0.2, now + 0.04);
  envelope.gain.setTargetAtTime(0.0001, now + 0.9, 0.28);

  fundamental.start(now);
  octave.start(now);
  fundamental.stop(now + 2.2);
  octave.stop(now + 2.2);
}

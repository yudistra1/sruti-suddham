/**
 * The drill: walk a cut one swara at a time, deciding when a swara has been
 * landed, when it has been missed, and what the attempt looked like.
 *
 * Deliberately free of audio and DOM. The UI feeds it a cents reading per
 * analysis frame and reacts to what comes back, which means the whole state
 * machine can be driven from a test with a made-up sequence of readings.
 */

import { CUTS } from './tuning.js';
import { HOLD_MS, TOLERANCE_CENTS, summarise } from './analysis.js';

/** How long a single swara may resist before the drill moves on without it. */
export const GIVE_UP_MS = 9000;
/** Silence longer than this ends the current phrase. */
const PHRASE_BREAK_MS = 300;
const MAX_TRACE = 900;

export class Drill {
  constructor(cutId) {
    this.cut = CUTS[cutId];
    this.steps = this.cut.steps;
    this.reset();
  }

  reset() {
    this.index = 0;
    this.results = [];
    this.holdMs = 0;
    this.quietMs = 0;
    this.stepMs = 0;
    this.holdTrace = [];   // the current unbroken phrase
    this.stepTrace = [];   // everything sung since this swara came up
    this.finished = false;
  }

  get target() {
    return this.steps[Math.min(this.index, this.steps.length - 1)];
  }

  get landedCount() {
    return this.results.filter((stats) => stats.landed).length;
  }

  get attempts() {
    return this.results.filter((stats) => stats.attempted);
  }

  /** 0..1 — how much of the required hold has been accumulated. */
  get holdProgress() {
    return Math.min(1, this.holdMs / HOLD_MS);
  }

  /**
   * One analysis frame in which a pitch was heard.
   *
   * @param {number} cents signed distance from the current target
   * @param {number} dt milliseconds since the previous frame
   * @param {number} now monotonic timestamp for the trace
   * @returns {{advanced: boolean, landed: boolean, swara: number}|null}
   */
  feedPitch(cents, dt, now) {
    if (this.finished) return null;
    this.stepMs += dt;

    this.holdTrace.push({ t: now, c: cents });
    if (this.holdTrace.length > MAX_TRACE) this.holdTrace.shift();
    this.stepTrace.push({ t: now, c: cents });
    if (this.stepTrace.length > MAX_TRACE) this.stepTrace.shift();

    if (Math.abs(cents) <= TOLERANCE_CENTS) {
      this.quietMs = 0;
      this.holdMs += dt;
      if (this.holdMs >= HOLD_MS) return this.advance(true, now);
      return null;
    }

    this.quietMs += dt;
    if (this.quietMs > PHRASE_BREAK_MS) {
      this.holdMs = 0;
    }
    if (this.stepMs > GIVE_UP_MS) return this.advance(false, now);
    return null;
  }

  /**
   * One analysis frame in which nothing was heard.
   *
   * @returns {{advanced: boolean, landed: boolean, swara: number}|null}
   */
  feedSilence(dt, now) {
    if (this.finished) return null;
    this.stepMs += dt;
    this.quietMs += dt;

    if (this.quietMs > PHRASE_BREAK_MS) {
      this.holdMs = 0;
      this.holdTrace = [];
    }
    if (this.stepMs > GIVE_UP_MS && this.stepTrace.length >= 4) {
      return this.advance(false, now);
    }
    return null;
  }

  /** Give up on the current swara by hand. */
  skip(now) {
    if (this.finished) return null;
    return this.advance(false, now);
  }

  advance(landed, now) {
    const swara = this.target;
    this.results.push(summarise({
      landed,
      now,
      holdTrace: this.holdTrace,
      stepTrace: this.stepTrace,
    }));

    this.index += 1;
    this.holdMs = 0;
    this.quietMs = 0;
    this.stepMs = 0;
    this.holdTrace = [];
    this.stepTrace = [];
    if (this.index >= this.steps.length) this.finished = true;

    return { advanced: true, landed, swara };
  }
}

/**
 * Monophonic pitch detection by normalised square difference (NSDF), the
 * function at the heart of McLeod & Wyvill's method.
 *
 * Plain autocorrelation biases toward the loudest partial and happily reports
 * an octave error on a sung vowel, which has a great deal of energy above the
 * fundamental. Normalising by the summed energy of both windows, then taking
 * the *first* peak that clears a fraction of the global maximum rather than
 * the maximum itself, is what keeps it on the fundamental.
 *
 * Cost is O(lags x window). With a 1024-sample window and lags capped at 700
 * that is ~700k multiply-adds per analysis; running it every other animation
 * frame keeps a laptop comfortable.
 */

const DEFAULTS = {
  windowSize: 1024,
  minHz: 65,        // a little under the lowest Sa anyone will sing here
  maxHz: 1100,      // a little over the highest
  silenceRms: 0.008,
  minClarity: 0.42,
  peakFraction: 0.9,
};

export class PitchDetector {
  constructor(sampleRate, options = {}) {
    const config = { ...DEFAULTS, ...options };
    this.sampleRate = sampleRate;
    this.windowSize = config.windowSize;
    this.silenceRms = config.silenceRms;
    this.minClarity = config.minClarity;
    this.peakFraction = config.peakFraction;
    this.minLag = Math.max(2, Math.floor(sampleRate / config.maxHz));
    this.maxLag = Math.floor(sampleRate / config.minHz);
    this.nsdf = new Float32Array(this.maxLag + 2);
    this.rms = 0;
  }

  /** Samples needed per call: one window plus the longest lag we compare at. */
  get requiredSamples() {
    return this.windowSize + this.maxLag + 1;
  }

  /**
   * @param {Float32Array} samples time-domain buffer, at least requiredSamples long
   * @returns {{frequency:number, clarity:number, rms:number}|null} null when
   *          the input is silent or too noisy to call
   */
  detect(samples) {
    const { windowSize, minLag, maxLag, nsdf } = this;

    let energy = 0;
    for (let i = 0; i < windowSize; i += 1) energy += samples[i] * samples[i];
    const rms = Math.sqrt(energy / windowSize);
    this.rms = rms;
    if (rms < this.silenceRms) return null;

    const usableLag = Math.min(maxLag, samples.length - windowSize - 1);
    let peak = 0;
    for (let lag = minLag; lag <= usableLag; lag += 1) {
      let correlation = 0;
      let norm = 0;
      for (let i = 0; i < windowSize; i += 1) {
        const a = samples[i];
        const b = samples[i + lag];
        correlation += a * b;
        norm += a * a + b * b;
      }
      const value = norm > 0 ? (2 * correlation) / norm : 0;
      nsdf[lag] = value;
      if (value > peak) peak = value;
    }
    if (peak < this.minClarity) return null;

    // First local maximum clearing peakFraction of the global peak. Taking the
    // first rather than the largest is the octave-error guard.
    const threshold = peak * this.peakFraction;
    let chosen = -1;
    for (let lag = minLag + 1; lag < usableLag; lag += 1) {
      if (nsdf[lag] >= threshold && nsdf[lag] >= nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1]) {
        chosen = lag;
        break;
      }
    }
    if (chosen < 0) return null;

    // Parabolic interpolation over the three points around the peak. Without
    // this the resolution is a whole sample of lag, which at 400Hz is ~20 cents.
    const y0 = nsdf[chosen - 1];
    const y1 = nsdf[chosen];
    const y2 = nsdf[chosen + 1];
    const denominator = 2 * (2 * y1 - y0 - y2);
    const shift = denominator !== 0 ? (y2 - y0) / denominator : 0;

    return {
      frequency: this.sampleRate / (chosen + shift),
      clarity: y1,
      rms,
    };
  }
}

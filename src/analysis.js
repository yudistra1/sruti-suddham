/**
 * Turning a stream of cents readings into the four things that are actually
 * wrong with a sung note.
 *
 * A tuner needle conflates them. They have different causes and different
 * fixes, so they are measured separately:
 *
 *   centre  where the pitch sat on average       - ear, or the wrong target
 *   wobble  how much it swung around that centre - breath, not ear
 *   onset   where the note started               - scooping up into it
 *   drift   how far it moved while being held    - support running out
 */

export const TOLERANCE_CENTS = 15;
export const HOLD_MS = 900;
/** How far off a reading can be and still count as an attempt at this swara. */
export const ATTEMPT_WINDOW_CENTS = 150;

export function mean(values) {
  if (!values.length) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/** Sample standard deviation. Zero for fewer than two readings. */
export function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  let sum = 0;
  for (const value of values) sum += (value - average) ** 2;
  return Math.sqrt(sum / (values.length - 1));
}

const EMPTY = {
  attempted: false,
  landed: false,
  centre: 0,
  wobble: 0,
  onset: 0,
  settle: 0,
  drift: 0,
};

/**
 * Reduce one attempt at a swara to its statistics.
 *
 * @param {{landed: boolean, now: number,
 *          holdTrace: Array<{t:number,c:number}>,
 *          stepTrace: Array<{t:number,c:number}>}} attempt
 *   holdTrace is the current unbroken phrase; stepTrace is everything sung
 *   since the swara came up, including false starts.
 */
export function summarise({ landed, now, holdTrace, stepTrace }) {
  let readings;
  let approach;

  if (landed) {
    // Only the sustained part counts toward the centre.
    readings = holdTrace.filter((p) => p.t >= now - HOLD_MS).map((p) => p.c);
    approach = holdTrace;
  } else {
    // A missed swara: ignore stretches where a different swara was being sung,
    // or the "centre" ends up averaging two unrelated notes.
    approach = stepTrace.filter((p) => Math.abs(p.c) <= ATTEMPT_WINDOW_CENTS);
    readings = approach.map((p) => p.c);
    if (!approach.length) approach = stepTrace;
  }

  if (readings.length < 4) return { ...EMPTY };

  const head = approach.slice(0, Math.min(3, approach.length)).map((p) => p.c);
  const third = Math.max(1, Math.floor(readings.length / 3));

  let settle = 0;
  if (landed) {
    const arrival = approach.find((p) => Math.abs(p.c) <= TOLERANCE_CENTS);
    if (arrival) settle = arrival.t - approach[0].t;
  }

  return {
    attempted: true,
    landed,
    centre: mean(readings),
    wobble: standardDeviation(readings),
    onset: mean(head),
    settle,
    drift: mean(readings.slice(-third)) - mean(readings.slice(0, third)),
  };
}

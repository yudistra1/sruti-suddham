/**
 * Everything the tool says out loud.
 *
 * Kept apart from the DOM and from the measurement code so the wording can be
 * tested directly: feed it a set of statistics, assert on what it says.
 */

import {
  INTERVAL_NAMES, KOMAL_PITCH_CLASSES, LEADING_PITCH_CLASSES,
  RATIO_LABELS, centsAboveSa, labelOf, sameSwara,
} from './tuning.js';
import { HOLD_MS, TOLERANCE_CENTS, mean } from './analysis.js';

const HOLD_SECONDS = (HOLD_MS / 1000).toFixed(1);

/** How far off, in words. */
function howFar(cents) {
  const distance = Math.abs(cents);
  if (distance <= TOLERANCE_CENTS) return null;
  if (distance < 30) return cents > 0 ? 'a shade sharp' : 'a shade flat';
  if (distance < 60) return cents > 0 ? 'sharp' : 'flat';
  if (distance < 110) return cents > 0 ? 'well sharp' : 'well flat';
  return cents > 0 ? 'far above' : 'far below';
}

const signed = (cents) => (cents >= 0 ? '+' : '−') + Math.abs(cents).toFixed(0);

/**
 * The line under the needle while someone is singing.
 *
 * Order matters: being on the wrong swara entirely is a different problem from
 * being twenty cents sharp, and saying "ease down a hair" to someone singing a
 * fourth too high is worse than saying nothing.
 *
 * @returns {{headline: string, detail: string, tone: 'idle'|'near'|'far'|'good'}}
 */
export function liveAdvice({ cents, target, singing, wobble }) {
  const distance = Math.abs(cents);

  if (distance > 60 && !sameSwara(singing, target)) {
    const gap = Math.abs(singing - target) % 12;
    const side = singing > target ? 'above' : 'below';
    return {
      headline: `That is ${labelOf(singing)}, not ${labelOf(target)}`,
      detail: `You are a ${INTERVAL_NAMES[gap] || 'wide interval'} ${side} the target. `
        + `Come ${singing > target ? 'down' : 'up'} to ${labelOf(target)} — `
        + 'press Hear this swara if you need it.',
      tone: 'far',
    };
  }

  if (distance > 600 && sameSwara(singing, target)) {
    return {
      headline: `${labelOf(target)} is right, the octave is not`,
      detail: `You are an octave ${cents > 0 ? 'above' : 'below'} the target. `
        + `Sing it ${cents > 0 ? 'lower' : 'higher'} — the reference tone will place it.`,
      tone: 'far',
    };
  }

  const verdict = howFar(cents);
  if (!verdict) {
    if (wobble > 14) {
      return {
        headline: 'In tune, but wobbling',
        detail: `The pitch is swinging about ±${wobble.toFixed(0)}¢. `
          + 'That is breath, not ear — fuller breath, even airflow, relaxed jaw.',
        tone: 'near',
      };
    }
    return {
      headline: 'Hold it there',
      detail: 'Steady inside the band. Keep the vowel open and do not push.',
      tone: 'good',
    };
  }

  const move = cents > 0 ? 'Ease down' : 'Lift up';
  const amount = distance < 30 ? 'just a hair' : distance < 60 ? 'a little' : 'clearly';
  return {
    headline: `${labelOf(target)} is ${verdict}`,
    detail: `${move} ${amount} — you are ${signed(cents)}¢ off the sruti.`,
    tone: distance < 30 ? 'near' : 'far',
  };
}

/**
 * The per-swara verdict in the report: a handful of tags, then the one or two
 * sentences most worth reading.
 *
 * @returns {{tags: Array<{text:string, bad:boolean}>, note: string}}
 */
export function diagnose(stats, semitone) {
  if (!stats.attempted) {
    return {
      tags: [{ text: 'not sung', bad: true }],
      note: '<b>Nothing came in for this swara.</b> Either it was skipped or the mic heard '
        + 'silence — sound it with Hear this swara and try the cut again.',
    };
  }

  const pitchClass = ((semitone % 12) + 12) % 12;
  const tags = [];
  const notes = [];
  const centre = stats.centre;
  const scooped = stats.onset < -35 && stats.onset > -200;
  const droppedIn = stats.onset > 35 && stats.onset < 200;

  if (!stats.landed) tags.push({ text: 'never landed', bad: true });
  if (Math.abs(centre) <= 6) tags.push({ text: 'centred', bad: false });
  else tags.push({ text: centre > 6 ? 'sat sharp' : 'sat flat', bad: true });

  if (stats.wobble > 14) tags.push({ text: 'unsteady', bad: true });
  else if (stats.wobble < 7) tags.push({ text: 'steady', bad: false });

  if (scooped) tags.push({ text: 'scooped up', bad: true });
  else if (droppedIn) tags.push({ text: 'dropped in', bad: true });

  if (stats.drift < -10) tags.push({ text: 'sagged', bad: true });
  else if (stats.drift > 10) tags.push({ text: 'crept up', bad: true });

  if (stats.landed && stats.settle > 1400) tags.push({ text: 'slow to find', bad: true });

  // The headline problem, in priority order. Only one of these fires.
  if (!stats.landed && Math.abs(centre) <= TOLERANCE_CENTS) {
    notes.push(`<b>Right pitch, never held.</b> Your centre was ${signed(centre)}¢ — `
      + `fine — but it kept sliding out of the band before ${HOLD_SECONDS}s were up. `
      + 'This is sustain, not intonation: one swara, one full breath, needle still.');
  } else if (!stats.landed) {
    notes.push(`<b>You never got inside ±${TOLERANCE_CENTS}¢ here.</b> You sat around `
      + `${signed(centre)}¢ for the whole attempt — a `
      + `${Math.abs(centre) > 45 ? 'wide' : 'persistent'} miss on ${labelOf(semitone)}, `
      + 'not a slip. Sound it, hum it back, then sing it.');
  } else if (centre > 10 && KOMAL_PITCH_CLASSES.has(pitchClass)) {
    notes.push(`<b>${labelOf(semitone)} is lower than your ear expects.</b> At `
      + `${RATIO_LABELS[pitchClass]} it sits only ${centsAboveSa(pitchClass).toFixed(0)}¢ above Sa `
      + '— much closer to Sa than a piano’s black key. Lean it down until it stops '
      + 'beating against the drone.');
  } else if (centre > 10 && LEADING_PITCH_CLASSES.has(pitchClass)) {
    const shortfall = (100 * pitchClass - centsAboveSa(pitchClass)).toFixed(0);
    notes.push(`<b>Guitar ear.</b> ${labelOf(semitone)} at ${RATIO_LABELS[pitchClass]} is about `
      + `${shortfall}¢ below where a fret puts it. Let it settle lower than feels right.`);
  } else if (centre < -10 && pitchClass === 0 && semitone > 0) {
    notes.push('<b>The upper Sa sagged.</b> The top of the octave needs more air, not more '
      + 'push — open the throat and let the breath do it.');
  } else if (Math.abs(centre) > 10) {
    notes.push(`<b>Consistently ${centre > 0 ? 'sharp' : 'flat'} by ${Math.abs(centre).toFixed(0)}¢.</b> `
      + `Sound ${labelOf(semitone)} with Hear this swara, then match it before you sing the phrase again.`);
  }

  if (scooped) {
    notes.push(`You <b>scooped up</b> into it from ${Math.abs(stats.onset).toFixed(0)}¢ below. `
      + 'Hear the swara in your head first and land on it — a slide up is a habit that gets '
      + 'expensive in fast passages.');
  } else if (droppedIn) {
    notes.push(`You <b>came down onto it</b> from ${stats.onset.toFixed(0)}¢ above. `
      + 'Aim for the pitch, not past it.');
  }
  if (stats.drift < -10) {
    notes.push(`It <b>fell ${Math.abs(stats.drift).toFixed(0)}¢ while you held it</b> — breath `
      + 'support running out. Breathe lower and do not sing on the last of the air.');
  }
  if (stats.wobble > 14) {
    notes.push(`Wobble of ±${stats.wobble.toFixed(0)}¢ across the hold. Steady airflow, relaxed jaw.`);
  }
  if (stats.landed && stats.settle > 1400) {
    notes.push(`Took ${(stats.settle / 1000).toFixed(1)}s to find it. Pitch it mentally against `
      + 'the tanpura’s Sa before opening your mouth.');
  }

  if (!notes.length) notes.push('Clean — landed and held it.');
  return { tags, note: notes.slice(0, 2).join(' ') };
}

/**
 * Habits visible across a whole cut but invisible note by note. These are the
 * findings worth acting on; the per-swara table is the supporting detail.
 *
 * @returns {Array<{headline: string, detail: string, good: boolean}>}
 */
export function findPatterns(results, steps) {
  const findings = [];
  const half = steps.length / 2;
  const ascending = [];
  const descending = [];
  const wobbles = [];
  let scoops = 0;
  let sags = 0;
  let missed = 0;
  let pulledSharp = 0;
  let pullable = 0;

  results.forEach((stats, index) => {
    if (!stats.attempted) return;
    if (!stats.landed) missed += 1;
    (index < half ? ascending : descending).push(stats.centre);
    wobbles.push(stats.wobble);
    if (stats.onset < -35 && stats.onset > -200) scoops += 1;
    if (stats.drift < -10) sags += 1;

    const pitchClass = ((steps[index] % 12) + 12) % 12;
    if (KOMAL_PITCH_CLASSES.has(pitchClass) || LEADING_PITCH_CLASSES.has(pitchClass)) {
      pullable += 1;
      if (stats.centre > 8) pulledSharp += 1;
    }
  });

  const attempted = results.filter((stats) => stats.attempted);
  const overall = mean(attempted.map((stats) => Math.abs(stats.centre)));

  if (missed >= Math.max(2, Math.ceil(attempted.length * 0.4))) {
    findings.push({
      headline: 'Most swaras never came inside the band.',
      detail: `${missed} of ${attempted.length} stayed outside ±${TOLERANCE_CENTS}¢ for the whole `
        + 'attempt. Before drilling the cut, spend a few minutes on Sa alone with the tanpura up '
        + '— one long akaara, needle still. Interval accuracy is built on a reliable Sa, not '
        + 'the other way round.',
      good: false,
    });
  }

  if (pullable >= 2 && pulledSharp >= Math.ceil(pullable * 0.6)) {
    findings.push({
      headline: 'Your ear is pulling toward equal temperament.',
      detail: `You sang ${pulledSharp} of ${pullable} of the just-intonation swaras `
        + '(Ri₁, Ga₃, Dha₁, Ni₃) sharp. Those four are exactly where a '
        + 'guitar-trained ear goes wrong — they all sit lower against a drone than they do on '
        + 'a fretboard. Practise them slowly with the tanpura up and stop when the beating '
        + 'disappears, not when it sounds familiar.',
      good: false,
    });
  }

  if (ascending.length && descending.length && mean(ascending) > 8 && mean(descending) < -8) {
    findings.push({
      headline: 'You overshoot going up and undershoot coming down.',
      detail: `Arohana averaged ${mean(ascending).toFixed(0)}¢ sharp, avarohana `
        + `${mean(descending).toFixed(0)}¢ flat. Classic momentum error — the voice keeps `
        + 'travelling past the note. Slow the varisai down and put a real stop on each swara.',
      good: false,
    });
  }

  if (scoops >= Math.max(2, Math.ceil(attempted.length * 0.4))) {
    findings.push({
      headline: 'You scoop into most notes.',
      detail: `${scoops} of ${attempted.length} swaras started more than a third of a semitone below `
        + 'and slid up. Use Hear this swara, sing it in your head, then start on it. This is the '
        + 'single habit that most limits speed later.',
      good: false,
    });
  }

  if (mean(wobbles) > 14) {
    findings.push({
      headline: 'Pitch is unsteady rather than wrong.',
      detail: `Average wobble was ±${mean(wobbles).toFixed(0)}¢, but your centres were close. `
        + 'That is breath management, not ear training. Long akaara on Sa — one swara, one full '
        + 'breath, needle still — will fix it faster than more varisai.',
      good: false,
    });
  }

  if (sags >= Math.max(2, Math.ceil(attempted.length * 0.35))) {
    findings.push({
      headline: 'Notes fall away as you hold them.',
      detail: `${sags} swaras dropped more than 10¢ over the hold. Breathe from lower down and `
        + 'aim to finish each note with air to spare.',
      good: false,
    });
  }

  if (!findings.length && attempted.length && overall <= 8) {
    findings.push({
      headline: 'Solidly centred throughout.',
      detail: `Average error ${overall.toFixed(1)}¢ — inside what most listeners can hear. `
        + 'Tighten it by singing the same cut with the drone louder, or move on to the second varisai.',
      good: true,
    });
  }

  if (!findings.length) {
    findings.push({
      headline: 'No single habit stands out.',
      detail: attempted.length
        ? `Average error was ${overall.toFixed(1)}¢ with no consistent direction. Work swara by `
          + 'swara from the table below.'
        : 'Nothing was heard during this run — check the input meter and the microphone selection.',
      good: false,
    });
  }

  return findings;
}

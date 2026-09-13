/**
 * The musical model: swarasthanas, ratios, cuts, and the cents arithmetic
 * everything else is measured in.
 *
 * Nothing in here touches the DOM or the Web Audio API, which is what makes
 * it testable under plain Node.
 */

/** Note names, sharps only — the picker offers one spelling per pitch class. */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Octaves worth offering: 2 reaches low male voices, 4 reaches high female ones. */
export const TONIC_OCTAVES = [2, 3, 4];

/** Where it starts: A#3, a comfortable Sa for a male voice. */
export const DEFAULT_TONIC = { note: 'A#', octave: 3 };

const A4_HZ = 440;

/** Frequency of a named note, equal-tempered against A4 = 440 Hz. */
export function noteToHz(note, octave) {
  const index = NOTE_NAMES.indexOf(note);
  if (index < 0) throw new Error(`unknown note: ${note}`);
  const semitonesFromA4 = index - 9 + (octave - 4) * 12;  // A4 is index 9, octave 4
  return A4_HZ * Math.pow(2, semitonesFromA4 / 12);
}

/** Display form, with a real sharp glyph. */
export function noteLabel(note, octave) {
  return `${note.replace('#', '♯')}${octave}`;
}

/**
 * The adhara shadja is the one piece of mutable state in here. Every target,
 * every ratio and the tanpura itself are derived from it, so changing it
 * retunes the whole app at once.
 */
let tonic = { ...DEFAULT_TONIC, hz: noteToHz(DEFAULT_TONIC.note, DEFAULT_TONIC.octave) };

export function setTonic(note, octave) {
  tonic = { note, octave, hz: noteToHz(note, octave) };
  return tonic;
}

export function getTonic() {
  return tonic;
}

/** Frequency of Sa. */
export function tonicHz() {
  return tonic.hz;
}

export function tonicLabel() {
  return noteLabel(tonic.note, tonic.octave);
}

/**
 * Just-intonation ratios for the twelve swarasthanas.
 *
 * These are the intervals a tanpura actually enforces. They are not the
 * equal-tempered ones: Ga3 at 5/4 is ~386c, a good 14c below a guitar's
 * major third, and Ni3 at 15/8 is ~1088c, 12c under the equal-tempered
 * leading tone. Singers trained on fretted instruments tend to sit sharp
 * on exactly these.
 */
export const JUST_RATIOS = [
  1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3,
  45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8,
];

export const RATIO_LABELS = [
  '1:1', '16:15', '9:8', '6:5', '5:4', '4:3',
  '45:32', '3:2', '8:5', '5:3', '9:5', '15:8',
];

/** The twelve swarasthanas, in semitone order from Sa. */
export const SWARASTHANAS = [
  { name: 'Sa', variant: '', devanagari: 'स' },
  { name: 'Ri', variant: '1', devanagari: 'रे' },
  { name: 'Ri', variant: '2', devanagari: 'रे' },
  { name: 'Ga', variant: '2', devanagari: 'ग' },
  { name: 'Ga', variant: '3', devanagari: 'ग' },
  { name: 'Ma', variant: '1', devanagari: 'म' },
  { name: 'Ma', variant: '2', devanagari: 'म' },
  { name: 'Pa', variant: '', devanagari: 'प' },
  { name: 'Dha', variant: '1', devanagari: 'ध' },
  { name: 'Dha', variant: '2', devanagari: 'ध' },
  { name: 'Ni', variant: '2', devanagari: 'नि' },
  { name: 'Ni', variant: '3', devanagari: 'नि' },
];

export const INTERVAL_NAMES = [
  'unison', 'semitone', 'whole tone', 'minor third', 'major third', 'fourth',
  'tritone', 'fifth', 'minor sixth', 'major sixth', 'minor seventh', 'major seventh',
];

/** Mayamalavagowla — the scale every Carnatic beginner is handed first. */
export const MAYAMALAVAGOWLA = [0, 1, 4, 5, 7, 8, 11, 12];

/**
 * Practice cuts, as semitone offsets from Sa. Each runs up and back down,
 * which is how varisai are actually sung.
 */
export const CUTS = {
  sapasa: {
    id: 'sapasa',
    title: 'Sa · Pa · Sa',
    blurb: 'Ascend and descend the fifth — the tanpura’s own two notes',
    steps: [0, 7, 12, 12, 7, 0],
  },
  sarali: {
    id: 'sarali',
    title: 'Sarali Varisai · Mayamalavagowla',
    blurb: 'Arohana and avarohana — sixteen swaras',
    steps: MAYAMALAVAGOWLA.concat(MAYAMALAVAGOWLA.slice().reverse()),
  },
};

/**
 * The flat-side swaras of Mayamalavagowla. A fretboard-trained ear reliably
 * sings these sharp, so they get their own diagnosis.
 */
export const KOMAL_PITCH_CLASSES = new Set([1, 8]);   // Ri1, Dha1
/** ...and these are where the pull toward a major third / leading tone shows. */
export const LEADING_PITCH_CLASSES = new Set([4, 11]); // Ga3, Ni3

const mod12 = (n) => ((n % 12) + 12) % 12;

/** Ratio of a semitone offset to the tonic, in the given temperament. */
export function ratioFor(semitone, temperament = 'just') {
  const octave = Math.floor(semitone / 12);
  const pitchClass = mod12(semitone);
  const base = temperament === 'just'
    ? JUST_RATIOS[pitchClass]
    : Math.pow(2, pitchClass / 12);
  return base * Math.pow(2, octave);
}

/** Absolute frequency of a semitone offset from Sa. */
export function frequencyOf(semitone, temperament = 'just') {
  return tonic.hz * ratioFor(semitone, temperament);
}

/** Signed distance in cents. Positive means `freq` is sharp of `reference`. */
export function centsBetween(freq, reference) {
  return 1200 * Math.log(freq / reference) / Math.LN2;
}

/**
 * Name a semitone offset. Octave displacement is marked the way Carnatic
 * notation marks it: a dot above for taara sthayi, below for mandra.
 */
export function describe(semitone) {
  const pitchClass = mod12(semitone);
  const octave = Math.floor(semitone / 12);
  const base = SWARASTHANAS[pitchClass];
  const dot = octave > 0 ? '̇' : octave < 0 ? '̣' : '';
  return {
    pitchClass,
    octave,
    name: base.name + dot,
    variant: base.variant,
    devanagari: base.devanagari + (octave > 0 ? 'ं' : ''),
  };
}

/** Plain-text label, e.g. "Ri1". Used in prose. */
export function labelOf(semitone) {
  const s = describe(semitone);
  return s.name + s.variant;
}

/** The same label as HTML, with the variant as a subscript. */
export function htmlLabelOf(semitone) {
  const s = describe(semitone);
  return s.variant ? `${s.name}<sub>${s.variant}</sub>` : s.name;
}

/** How the target is expressed: a ratio in just intonation, cents in equal. */
export function ratioLabel(semitone, temperament = 'just') {
  const pitchClass = mod12(semitone);
  const octave = Math.floor(semitone / 12);
  if (temperament !== 'just') return `${100 * pitchClass + 1200 * octave}¢ ET`;
  if (octave === 1 && pitchClass === 0) return '2 : 1';
  if (octave === -1) return `${RATIO_LABELS[pitchClass]} ÷ 2`;
  return RATIO_LABELS[pitchClass];
}

/** Cents of the pitch class above Sa, in the given temperament. */
export function centsAboveSa(pitchClass, temperament = 'just') {
  return 1200 * Math.log(ratioFor(pitchClass, temperament)) / Math.LN2;
}

/**
 * Nearest swarasthana to a frequency, as a semitone offset from Sa.
 *
 * The equal-tempered guess gets us within one semitone; we then check the
 * three candidates against the *actual* targets, because just-intonation
 * targets can sit up to ~22c away from where equal temperament puts them.
 */
export function nearestSwarasthana(freq, temperament = 'just') {
  const guess = Math.round(12 * Math.log(freq / tonic.hz) / Math.LN2);
  let best = guess;
  let bestDistance = Infinity;
  for (let s = guess - 1; s <= guess + 1; s += 1) {
    const distance = Math.abs(centsBetween(freq, frequencyOf(s, temperament)));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = s;
    }
  }
  return best;
}

/** True when two semitone offsets name the same swara in different octaves. */
export function sameSwara(a, b) {
  return mod12(a - b) === 0;
}

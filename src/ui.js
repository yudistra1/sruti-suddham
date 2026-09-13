/**
 * DOM wiring and the animation loop. Everything stateful about the page lives
 * here; the modules it calls into are all pure or self-contained.
 */

import {
  CUTS, DEFAULT_TONIC, NOTE_NAMES, TONIC_OCTAVES, centsBetween, describe,
  frequencyOf, getTonic, htmlLabelOf, labelOf, nearestSwarasthana, noteLabel,
  noteToHz, ratioLabel, sameSwara, setTonic, tonicHz,
} from './tuning.js';
import { TOLERANCE_CENTS, HOLD_MS, mean, standardDeviation } from './analysis.js';
import { PitchDetector } from './pitch.js';
import { Microphone, explainFailure } from './microphone.js';
import { Tanpura, soundSwara } from './tanpura.js';
import { Drill } from './drill.js';
import { diagnose, findPatterns, liveAdvice } from './coach.js';

const $ = (id) => document.getElementById(id);

/** Frames between pitch analyses. Every other frame is plenty and halves cost. */
const ANALYSIS_STRIDE = 2;
/** Keep a coaching message on screen this long before the live loop resumes. */
const MESSAGE_HOLD_MS = 1800;
/** Readings kept for the live wobble figure — about a third of a second. */
const WOBBLE_WINDOW = 18;
/** Beyond this the cents figure is easier to read as semitones. */
const SEMITONE_READOUT_CENTS = 250;

const formatCents = (cents) => (cents >= 0 ? '+' : '−') + Math.abs(cents).toFixed(0);

export function start() {
  const el = {
    modeTuner: $('m-tuner'),
    modeSapasa: $('m-sapasa'),
    modeSarali: $('m-sarali'),
    micButton: $('mic-btn'),
    micDot: $('mic-dot'),
    micLabel: $('mic-label'),
    micSelect: $('mic-select'),
    tonicNote: $('tonic-note'),
    tonicOctave: $('tonic-octave'),
    tonicHz: $('tonic-hz'),
    tanpuraButton: $('tanpura-btn'),
    volume: $('vol'),
    warning: $('warn'),
    hertz: $('hz-out'),
    octave: $('oct-out'),
    cents: $('cents-out'),
    direction: $('dir-out'),
    swara: $('swara'),
    glyph: $('glyph'),
    devanagari: $('deva'),
    ratio: $('ratio'),
    ribbon: $('ribbon'),
    ticks: $('ticks'),
    trail: $('trail'),
    needle: $('needle'),
    coach: $('coach'),
    coachLine: $('coach-line'),
    coachSub: $('coach-sub'),
    holdFill: $('hold-fill'),
    levelFill: $('level-fill'),
    hearButton: $('hear-btn'),
    skipButton: $('skip-btn'),
    cutTitle: $('cut-title'),
    cutMeta: $('cut-meta'),
    ladder: $('ladder'),
    statLanded: $('st-hit'),
    statAverage: $('st-avg'),
    statWobble: $('st-steady'),
    statRun: $('st-run'),
    report: $('report'),
    patterns: $('patterns'),
    reportTable: $('rc'),
    justButton: $('t-just'),
    equalButton: $('t-equal'),
    resetButton: $('reset-btn'),
  };

  const state = {
    mode: 'tuner',
    temperament: 'just',
    drill: null,
    audio: null,
    mic: null,
    detector: null,
    tanpura: null,
    smoothedHz: -1,
    recent: [],
    lastFrame: 0,
    frame: 0,
    messageUntil: 0,
  };

  drawTicks(el.ticks);

  /* ---------------------------------------------------------------- audio */

  function audioContext() {
    if (!state.audio) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      state.audio = new Ctor();
      state.tanpura = new Tanpura(state.audio, { temperament: state.temperament });
    }
    if (state.audio.state === 'suspended') state.audio.resume();
    return state.audio;
  }

  /* ----------------------------------------------------------------- copy */

  function say(headline, detail, tone) {
    if (el.coachLine.textContent !== headline) el.coachLine.textContent = headline;
    if (el.coachSub.textContent !== detail) el.coachSub.textContent = detail;
    if (el.coach.dataset.tone !== tone) el.coach.dataset.tone = tone;
  }

  function flash(headline, detail, tone, now) {
    say(headline, detail, tone);
    state.messageUntil = now + MESSAGE_HOLD_MS;
  }

  function promptForTarget() {
    if (state.drill && !state.drill.finished) {
      say(
        `Sing ${labelOf(state.drill.target)}`,
        `Hold it inside the green band for ${(HOLD_MS / 1000).toFixed(1)}s and the drill moves on.`,
        'idle',
      );
    } else if (!state.drill) {
      say(
        state.mic && state.mic.active ? 'Sing any swara' : 'Turn on the mic, then sing Sa',
        state.mic && state.mic.active
          ? 'The tuner names the nearest swarasthana and tells you which way to move.'
          : 'Start the tanpura first so you have something to tune against.',
        'idle',
      );
    }
  }

  /* --------------------------------------------------------------- render */

  function renderLadder() {
    const steps = state.drill ? state.drill.steps : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const results = state.drill ? state.drill.results : [];
    el.ladder.innerHTML = steps.map((semitone, index) => {
      const stats = results[index];
      let position = 'idle';
      if (state.drill) {
        if (index < state.drill.index) position = 'done';
        else if (index === state.drill.index && !state.drill.finished) position = 'current';
      }
      const missed = stats && (!stats.landed || Math.abs(stats.centre) > 10);
      const arrow = state.drill ? (index < steps.length / 2 ? '↑' : '↓') : '';
      const figure = stats
        ? (stats.attempted ? `${formatCents(stats.centre)}¢` : '—')
        : frequencyOf(semitone, state.temperament).toFixed(1);

      return `<div class="step${position === 'done' && missed ? ' wide' : ''}" data-state="${position}">`
        + (arrow ? `<div class="arc">${arrow}</div>` : '')
        + `<div class="s-name">${htmlLabelOf(semitone)}</div>`
        + `<div class="s-hz">${figure}</div>`
        + '</div>';
    }).join('');

    const heading = state.drill
      ? [state.drill.cut.title, state.drill.cut.blurb]
      : ['The twelve swarasthanas', `Free tuner · nearest swara in ${noteLabel(getTonic().note, getTonic().octave)} sruti`];
    el.cutTitle.textContent = heading[0];
    el.cutMeta.textContent = `${heading[1]} · ${state.temperament === 'just' ? 'just intonation' : 'equal temperament'}`;

    const landed = state.drill ? state.drill.landedCount : 0;
    const total = state.drill ? state.drill.steps.length : 0;
    el.statLanded.innerHTML = `${landed}<span style="font-size:.6em;color:var(--text-3)">/${total}</span>`;
  }

  function renderTarget() {
    if (!state.drill) return;
    const semitone = state.drill.target;
    el.glyph.innerHTML = htmlLabelOf(semitone);
    el.devanagari.textContent = describe(semitone).devanagari;
    el.ratio.textContent = `${ratioLabel(semitone, state.temperament)}  ·  `
      + `${frequencyOf(semitone, state.temperament).toFixed(2)} Hz`;
  }

  function renderStats() {
    const attempts = state.drill ? state.drill.attempts : [];
    el.statAverage.textContent = attempts.length
      ? mean(attempts.map((stats) => Math.abs(stats.centre))).toFixed(1)
      : '—';
    el.statWobble.textContent = attempts.length
      ? `±${mean(attempts.map((stats) => stats.wobble)).toFixed(0)}`
      : '—';
  }

  function renderNeedle(cents, live) {
    const clamped = Math.max(-50, Math.min(50, cents));
    el.needle.style.left = `${50 + clamped}%`;
    if (!live) {
      el.needle.className = 'needle';
      el.trail.style.width = '0';
      return;
    }
    const distance = Math.abs(cents);
    el.needle.className = `needle ${distance <= TOLERANCE_CENTS ? 'intune' : cents < 0 ? 'flat' : 'sharp'}`;

    // A faint bar from where the phrase started to where it is now, which makes
    // a scoop visible as it happens rather than only in the report.
    const trace = state.drill ? state.drill.holdTrace : [];
    if (trace.length > 1) {
      const from = Math.max(-50, Math.min(50, trace[0].c));
      el.trail.style.left = `${50 + Math.min(from, clamped)}%`;
      el.trail.style.width = `${Math.abs(clamped - from)}%`;
    }
  }

  function renderReport() {
    const { drill } = state;
    const attempts = drill.attempts;
    const average = mean(attempts.map((stats) => Math.abs(stats.centre)));

    el.statRun.textContent = 'complete';
    el.skipButton.hidden = true;
    el.holdFill.style.width = '100%';
    renderLadder();
    renderStats();

    say(
      `Cut complete — ${drill.landedCount} of ${drill.results.length} landed`,
      attempts.length
        ? `Average error ${average.toFixed(1)}¢. The notes below say what to fix first.`
        : 'Nothing was heard — check the input meter and the microphone selection.',
      drill.landedCount === drill.results.length && average <= 10 ? 'good' : 'near',
    );

    el.patterns.innerHTML = findPatterns(drill.results, drill.steps)
      .map((finding) => `<div class="pattern${finding.good ? ' good' : ''}" style="margin-bottom:8px">`
        + `<b>${finding.headline}</b> ${finding.detail}</div>`)
      .join('');

    const rows = ['<div class="rc-row head"><span>Swara</span><span>Landed</span><span>What to fix</span></div>'];
    drill.results.forEach((stats, index) => {
      const semitone = drill.steps[index];
      const { tags, note } = diagnose(stats, semitone);
      const tint = !stats.attempted ? '' : Math.abs(stats.centre) <= 6 ? 'ok' : stats.centre > 0 ? 'sharp' : 'flat';
      const arrow = index < drill.steps.length / 2 ? '↑' : '↓';
      rows.push(
        '<div class="rc-row">'
        + `<div class="rc-sw">${htmlLabelOf(semitone)} <span style="font-family:var(--fm);font-size:9px;color:var(--text-3)">${arrow}</span></div>`
        + `<div class="rc-c ${tint}">${stats.attempted ? `${formatCents(stats.centre)}¢` : '—'}</div>`
        + `<div><div class="chips">${tags.map((tag) => `<span class="chip ${tag.bad ? 'bad' : 'ok'}">${tag.text}</span>`).join('')}</div>`
        + `<div class="rc-note">${note}</div></div>`
        + '</div>',
      );
    });
    el.reportTable.innerHTML = rows.join('');
    el.report.hidden = false;
  }

  /* ----------------------------------------------------------------- modes */

  function setMode(mode) {
    state.mode = mode;
    state.drill = CUTS[mode] ? new Drill(mode) : null;
    state.recent = [];
    state.messageUntil = 0;

    el.modeTuner.setAttribute('aria-pressed', String(mode === 'tuner'));
    el.modeSapasa.setAttribute('aria-pressed', String(mode === 'sapasa'));
    el.modeSarali.setAttribute('aria-pressed', String(mode === 'sarali'));

    el.report.hidden = true;
    el.skipButton.hidden = !state.drill;
    el.holdFill.style.width = '0%';
    el.trail.style.width = '0';
    el.statRun.textContent = state.drill ? 'in progress' : '—';

    renderLadder();
    renderStats();
    if (state.drill) {
      renderTarget();
    } else {
      el.glyph.textContent = 'Sa';
      el.devanagari.textContent = describe(0).devanagari;
      el.ratio.textContent = `1 : 1  ·  ${tonicHz().toFixed(2)} Hz`;
    }
    promptForTarget();
  }

  function setTemperament(temperament) {
    state.temperament = temperament;
    el.justButton.setAttribute('aria-pressed', String(temperament === 'just'));
    el.equalButton.setAttribute('aria-pressed', String(temperament === 'equal'));
    if (state.tanpura) state.tanpura.setTemperament(temperament);
    renderLadder();
    renderTarget();
  }

  /* ---------------------------------------------------------------- tonic */

  const TONIC_KEY = 'sruti-suddham:tonic';

  function loadTonic() {
    try {
      const saved = JSON.parse(localStorage.getItem(TONIC_KEY) || 'null');
      if (saved && NOTE_NAMES.includes(saved.note) && TONIC_OCTAVES.includes(saved.octave)) {
        return saved;
      }
    } catch {
      // Private browsing, blocked storage — fall through to the default.
    }
    return DEFAULT_TONIC;
  }

  function rememberTonic(note, octave) {
    try {
      localStorage.setItem(TONIC_KEY, JSON.stringify({ note, octave }));
    } catch {
      // Not worth telling the user about; the session still works.
    }
  }

  function buildTonicPicker() {
    el.tonicNote.innerHTML = NOTE_NAMES
      .map((note) => `<option value="${note}">${note.replace('#', '\u266F')}</option>`)
      .join('');
    el.tonicOctave.innerHTML = TONIC_OCTAVES
      .map((octave) => `<option value="${octave}">${octave}</option>`)
      .join('');

    const start = loadTonic();
    setTonic(start.note, start.octave);
    el.tonicNote.value = start.note;
    el.tonicOctave.value = String(start.octave);
    el.tonicHz.textContent = `${tonicHz().toFixed(2)} Hz`;

    const onChange = () => {
      const note = el.tonicNote.value;
      const octave = Number(el.tonicOctave.value);
      setTonic(note, octave);
      rememberTonic(note, octave);
      el.tonicHz.textContent = `${tonicHz().toFixed(2)} Hz`;
      // The drone is built from the tonic, and any results so far were measured
      // against the old one, so both have to go.
      if (state.tanpura) state.tanpura.retune();
      state.smoothedHz = -1;
      setMode(state.mode);
    };
    el.tonicNote.addEventListener('change', onChange);
    el.tonicOctave.addEventListener('change', onChange);
  }

  /* ------------------------------------------------------------- controls */

  el.modeTuner.addEventListener('click', () => setMode('tuner'));
  el.modeSapasa.addEventListener('click', () => setMode('sapasa'));
  el.modeSarali.addEventListener('click', () => setMode('sarali'));
  el.justButton.addEventListener('click', () => setTemperament('just'));
  el.equalButton.addEventListener('click', () => setTemperament('equal'));
  el.resetButton.addEventListener('click', () => setMode(state.mode));

  el.tanpuraButton.addEventListener('click', () => {
    audioContext();
    const { tanpura } = state;
    if (tanpura.playing) tanpura.stop();
    else tanpura.start();
    el.tanpuraButton.setAttribute('aria-pressed', String(tanpura.playing));
    el.tanpuraButton.textContent = tanpura.playing ? 'Tanpura on' : 'Tanpura';
  });

  el.volume.addEventListener('input', (event) => {
    if (state.tanpura) state.tanpura.setVolume(event.target.value / 100);
  });

  el.hearButton.addEventListener('click', () => {
    const context = audioContext();
    const semitone = state.drill ? state.drill.target : 0;
    soundSwara(context, frequencyOf(semitone, state.temperament));
  });

  el.skipButton.addEventListener('click', () => {
    if (!state.drill || state.drill.finished) return;
    const skipped = labelOf(state.drill.target);
    state.drill.skip(performance.now());
    afterAdvance();
    if (!state.drill.finished) {
      flash(
        `Skipped ${skipped}`,
        'It is logged as a miss so the report still covers it. Come back to it with the reference tone.',
        'near',
        performance.now(),
      );
    }
  });

  el.micSelect.addEventListener('change', async (event) => {
    if (!state.mic || !state.mic.active) return;
    try {
      await state.mic.open(event.target.value);
    } catch (error) {
      showWarning(error);
    }
  });

  el.micButton.addEventListener('click', toggleMicrophone);

  function showWarning(error) {
    el.warning.classList.add('show');
    el.warning.innerHTML = `<b>The microphone is not available.</b> ${explainFailure(error)} `
      + 'The tanpura and the reference tones work either way.'
      + (error && error.name ? ` <span style="opacity:.7">(${error.name})</span>` : '');
  }

  async function populateDevices() {
    const devices = await Microphone.list();
    const chosen = el.micSelect.value;
    el.micSelect.innerHTML = '<option value="">Default microphone</option>'
      + devices.map((device) => `<option value="${device.id}">${device.label}</option>`).join('');
    if (chosen) el.micSelect.value = chosen;
  }

  async function toggleMicrophone() {
    if (state.mic && state.mic.active) {
      state.mic.close();
      el.micDot.className = 'dot';
      el.micLabel.textContent = 'Turn on mic';
      el.micButton.className = 'btn primary';
      el.ribbon.classList.add('idle');
      say('Mic off', 'Turn it back on when you are ready to sing.', 'idle');
      return;
    }

    try {
      const context = audioContext();
      if (!state.mic) state.mic = new Microphone(context);
      await state.mic.open(el.micSelect.value);
      await populateDevices();
      state.detector = new PitchDetector(context.sampleRate);

      el.warning.classList.remove('show');
      el.micDot.className = 'dot live';
      el.micLabel.textContent = 'Mic listening';
      el.micButton.className = 'btn';
      el.ribbon.classList.remove('idle');
      promptForTarget();
    } catch (error) {
      showWarning(error);
    }
  }

  /* ------------------------------------------------------------------ loop */

  function afterAdvance() {
    renderStats();
    if (state.drill.finished) renderReport();
    else {
      renderLadder();
      renderTarget();
      el.holdFill.style.width = '0%';
      el.trail.style.width = '0';
    }
  }

  function clearReadout() {
    el.hertz.textContent = '—  Hz';
    el.cents.textContent = '—';
    el.direction.textContent = 'cents';
    el.octave.textContent = 'quiet';
    el.swara.classList.remove('intune');
    renderNeedle(0, false);
  }

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = state.lastFrame ? now - state.lastFrame : 16;
    state.lastFrame = now;
    state.frame += 1;

    if (!state.mic || !state.mic.active || !state.detector) return;
    if (state.frame % ANALYSIS_STRIDE) return;
    const elapsed = dt * ANALYSIS_STRIDE;

    const samples = state.mic.read();
    const reading = state.detector.detect(samples);
    el.levelFill.style.width = `${Math.min(100, state.detector.rms * 900)}%`;

    if (!reading) {
      clearReadout();
      const outcome = state.drill ? state.drill.feedSilence(elapsed, now) : null;
      if (outcome) {
        const missed = labelOf(outcome.swara);
        afterAdvance();
        if (!state.drill.finished) {
          flash(`Moving on from ${missed}`,
            'Logged as a miss — the report at the end will say what went wrong there.',
            'near', now);
        }
        return;
      }
      if (now > state.messageUntil && !(state.drill && state.drill.finished)) {
        if (state.detector.rms < 0.004) {
          say('Nothing coming in',
            'The input meter is empty. If macOS handed the mic to another device, pick the right '
            + 'one from the dropdown.', 'idle');
        } else {
          promptForTarget();
        }
      }
      return;
    }

    // Light smoothing. Vowels are not perfectly periodic and the raw estimate
    // jitters a cent or two frame to frame; this settles the needle without
    // hiding an actual wobble.
    state.smoothedHz = state.smoothedHz > 0
      ? state.smoothedHz * 0.45 + reading.frequency * 0.55
      : reading.frequency;
    const hz = state.smoothedHz;
    el.hertz.textContent = `${hz.toFixed(1)} Hz`;

    const singing = nearestSwarasthana(hz, state.temperament);
    const drilling = Boolean(state.drill) && !state.drill.finished;
    const target = drilling ? state.drill.target : singing;
    const cents = centsBetween(hz, frequencyOf(target, state.temperament));
    const distance = Math.abs(cents);

    if (!drilling) {
      el.glyph.innerHTML = htmlLabelOf(target);
      el.devanagari.textContent = describe(target).devanagari;
      el.ratio.textContent = `${ratioLabel(target, state.temperament)}  ·  `
        + `${frequencyOf(target, state.temperament).toFixed(2)} Hz`;
    }

    state.recent.push(cents);
    if (state.recent.length > WOBBLE_WINDOW) state.recent.shift();
    const wobble = standardDeviation(state.recent);

    if (distance > SEMITONE_READOUT_CENTS) {
      el.cents.textContent = `${cents >= 0 ? '+' : '−'}${(distance / 100).toFixed(1)}`;
      el.direction.textContent = 'semitones off';
    } else {
      el.cents.textContent = formatCents(cents);
      el.direction.textContent = distance <= TOLERANCE_CENTS
        ? 'in sruti'
        : cents < 0 ? 'flat ¢' : 'sharp ¢';
    }

    if (!drilling) el.octave.textContent = 'nearest swarasthana';
    else if (distance <= 600) el.octave.textContent = 'in the right octave';
    else if (sameSwara(singing, target)) el.octave.textContent = cents < 0 ? 'an octave low' : 'an octave high';
    else el.octave.textContent = `singing ${labelOf(singing)}`;

    el.swara.classList.toggle('intune', distance <= TOLERANCE_CENTS);
    renderNeedle(cents, true);

    if (drilling) {
      const outcome = state.drill.feedPitch(cents, elapsed, now);
      el.holdFill.style.width = `${state.drill.holdProgress * 100}%`;
      if (outcome) {
        const swara = labelOf(outcome.swara);
        afterAdvance();
        if (!outcome.landed && !state.drill.finished) {
          flash(`Moving on from ${swara}`,
            'Logged as a miss — the report at the end will say what went wrong there.',
            'near', now);
        }
        return;
      }
    }

    if (now > state.messageUntil && !(state.drill && state.drill.finished)) {
      const advice = liveAdvice({ cents, target, singing, wobble });
      say(advice.headline, advice.detail, advice.tone);
    }
  }

  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      if (state.mic && state.mic.active) populateDevices();
    });
  }

  buildTonicPicker();
  setMode('tuner');
  requestAnimationFrame(loop);
}

function drawTicks(container) {
  const marks = [];
  for (let cents = -50; cents <= 50; cents += 10) {
    const kind = cents === 0 ? ' center' : Math.abs(cents) === 50 ? ' major' : '';
    marks.push(`<div class="tick${kind}" style="left:${50 + cents}%"></div>`);
    // Labels every 20c: the edges would be clipped by the ribbon's own border.
    if (cents % 20 === 0) {
      marks.push(`<div class="tick-label" style="left:${50 + cents}%">${cents > 0 ? '+' : ''}${cents}</div>`);
    }
  }
  container.innerHTML = marks.join('');
}

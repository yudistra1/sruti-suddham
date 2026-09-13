/**
 * Microphone capture, with the awkward parts handled.
 *
 * Two things bite here. First, not every input accepts the processing
 * constraints — some reject `echoCancellation` outright with an
 * OverconstrainedError rather than ignoring it — so we ask for what we want and
 * fall back twice rather than failing the whole session. Second, macOS will
 * quietly hand the default input to a nearby iPhone via Continuity Camera,
 * which is both laggy and heavily processed, so the device list has to be
 * offered to the user rather than trusting the default.
 */

const WANTED = {
  echoCancellation: true,   // the drone leaks back in on open speakers
  noiseSuppression: false,  // eats the quiet part of a held note
  autoGainControl: false,   // would fight the input meter
};

const FATAL = new Set(['NotAllowedError', 'SecurityError']);

export class Microphone {
  constructor(context) {
    this.context = context;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.buffer = null;
    this.deviceId = '';
  }

  get active() {
    return Boolean(this.stream);
  }

  async open(deviceId = '') {
    const stream = await requestStream(deviceId);

    if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
    if (this.source) {
      try { this.source.disconnect(); } catch { /* already gone */ }
    }

    this.stream = stream;
    this.deviceId = deviceId;
    this.source = this.context.createMediaStreamSource(stream);

    // Rumble, handling noise and mains hum all live below the lowest Sa.
    const highpass = this.context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 60;

    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    this.buffer = new Float32Array(this.analyser.fftSize);

    this.source.connect(highpass);
    highpass.connect(this.analyser);
  }

  close() {
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.analyser = null;
  }

  /** Latest time-domain frame, or null when the mic is closed. */
  read() {
    if (!this.analyser) return null;
    this.analyser.getFloatTimeDomainData(this.buffer);
    return this.buffer;
  }

  /**
   * Inputs the browser will name for us. Labels are empty until permission has
   * been granted at least once, so this is worth calling again after open().
   */
  static async list() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((device) => device.kind === 'audioinput')
        .filter((device) => device.deviceId && device.deviceId !== 'default')
        .map((device) => ({ id: device.deviceId, label: device.label || 'Input' }));
    } catch {
      return [];
    }
  }
}

async function requestStream(deviceId) {
  const exact = deviceId ? { deviceId: { exact: deviceId } } : null;

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: exact ? { ...WANTED, ...exact } : WANTED,
    });
  } catch (error) {
    if (FATAL.has(error.name)) throw error;
  }

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: exact || true });
  } catch (error) {
    if (FATAL.has(error.name)) throw error;
  }

  return navigator.mediaDevices.getUserMedia({ audio: true });
}

/** What to tell the user when capture fails. */
export function explainFailure(error) {
  switch (error && error.name) {
    case 'NotAllowedError':
      return 'Permission was blocked — allow microphone access for this page and press the '
        + 'button again.';
    case 'NotFoundError':
      return 'No audio input was found. Connect a microphone, then press the button again.';
    case 'NotReadableError':
      return 'The input is busy — another app has the microphone. Close it, or pick a '
        + 'different input from the dropdown.';
    default:
      return 'Microphone capture needs a secure context. Serve the page over http://localhost '
        + 'or https rather than opening the file directly.';
  }
}

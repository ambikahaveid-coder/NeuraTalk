/**
 * Speaker voice-gender estimation from live PCM, so translated speech is
 * voiced with the same gender as the person speaking (a male caller must
 * never be heard through a female voice, or vice versa).
 *
 * Method: normalized autocorrelation pitch (F0) tracking over 40 ms windows
 * of 16 kHz mono PCM, then the median F0 of voiced windows. Adult male speech
 * typically sits around 85–155 Hz and female around 165–255 Hz; the median
 * over ~1 s of voiced audio separates the two reliably for typical adult
 * voices. The decision is locked once made and never changes for the rest of
 * the call, so a listener never hears the voice switch mid-conversation.
 */

export type VoiceGender = "male" | "female";

const SAMPLE_RATE = 16_000;
const MIN_F0_HZ = 70;
const MAX_F0_HZ = 350;
const MIN_LAG = Math.floor(SAMPLE_RATE / MAX_F0_HZ);
const MAX_LAG = Math.ceil(SAMPLE_RATE / MIN_F0_HZ);
const WINDOW = 640; // 40 ms — must exceed 2 × MAX_LAG for the lowest pitches
const VOICED_CORRELATION = 0.6;
const PEAK_FRACTION = 0.85;
const RMS_GATE = 0.02;
/**
 * Median-F0 boundary between male and female voices. Indian adult speech
 * averages roughly 130 Hz (men) and 225 Hz (women); 165 Hz keeps both error
 * rates low. No threshold is perfect — a user-chosen profile gender, passed
 * as participant metadata `voiceGender`, always takes precedence.
 */
const GENDER_BOUNDARY_HZ = 165;
/** Voiced 20 ms frames (~1 s) after which the decision is locked on its own. */
const LOCK_AFTER_SAMPLES = 50;
/** Minimum voiced frames for a decision when one is forced before that. */
const MIN_SAMPLES_FOR_DECISION = 8;
const MAX_SAMPLES = 400;

/** Estimate F0 of one window, or null when it is unvoiced/too quiet. */
export function estimatePitchHz(window: Float32Array): number | null {
  const n = window.length;
  if (n < MAX_LAG * 2) return null;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += window[i];
  mean /= n;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    window[i] -= mean;
    energy += window[i] * window[i];
  }
  if (Math.sqrt(energy / n) < RMS_GATE) return null;

  const span = n - MAX_LAG;
  const corr = new Float32Array(MAX_LAG + 2);
  let best = 0;
  for (let lag = MIN_LAG; lag <= MAX_LAG + 1; lag++) {
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let i = 0; i < span; i++) {
      const a = window[i];
      const b = window[i + lag];
      xy += a * b;
      xx += a * a;
      yy += b * b;
    }
    const r = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
    corr[lag] = r;
    if (lag <= MAX_LAG && r > best) best = r;
  }
  if (best < VOICED_CORRELATION) return null;

  // First local peak close to the global best, which avoids period-doubling
  // (reporting half the real pitch would misclassify women as men).
  for (let lag = MIN_LAG + 1; lag <= MAX_LAG; lag++) {
    const r = corr[lag];
    if (r >= best * PEAK_FRACTION && r >= corr[lag - 1] && r >= corr[lag + 1]) {
      return SAMPLE_RATE / lag;
    }
  }
  return null;
}

export function classifyMedianPitch(pitches: number[]): VoiceGender {
  const sorted = [...pitches].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return median < GENDER_BOUNDARY_HZ ? "male" : "female";
}

export class VoiceGenderEstimator {
  private readonly history = new Float32Array(WINDOW);
  private filled = 0;
  private readonly pitches: number[] = [];
  private locked: VoiceGender | null = null;

  constructor(explicit?: VoiceGender | null) {
    if (explicit) this.locked = explicit;
  }

  /** Feed one 16 kHz mono PCM frame (any length). */
  push(frame: Int16Array): void {
    if (this.locked) return;

    const len = Math.min(frame.length, WINDOW);
    this.history.copyWithin(0, len);
    for (let i = 0; i < len; i++) {
      this.history[WINDOW - len + i] = frame[frame.length - len + i] / 32768;
    }
    this.filled = Math.min(WINDOW, this.filled + len);
    if (this.filled < WINDOW) return;

    const pitch = estimatePitchHz(Float32Array.from(this.history));
    if (pitch === null) return;
    this.pitches.push(pitch);
    if (this.pitches.length > MAX_SAMPLES) this.pitches.shift();
    if (this.pitches.length >= LOCK_AFTER_SAMPLES) {
      this.locked = classifyMedianPitch(this.pitches);
    }
  }

  /** Current decision without locking it, or null if still unknown. */
  peek(): VoiceGender | null {
    if (this.locked) return this.locked;
    return this.pitches.length >= MIN_SAMPLES_FOR_DECISION ? classifyMedianPitch(this.pitches) : null;
  }

  /**
   * The gender to voice this speaker with. The first call locks the answer
   * for the rest of the call so the voice can never flip between sentences.
   */
  resolve(fallback: VoiceGender = "female"): VoiceGender {
    if (!this.locked) this.locked = this.peek() ?? fallback;
    return this.locked;
  }

  get isLocked(): boolean {
    return this.locked !== null;
  }
}

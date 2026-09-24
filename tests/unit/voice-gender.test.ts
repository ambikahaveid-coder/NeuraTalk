import { describe, expect, it } from "vitest";
import { VoiceGenderEstimator, estimatePitchHz, classifyMedianPitch } from "../../server/voice-gender";

const SR = 16_000;

/** Voice-like signal: fundamental plus decaying harmonics, slight vibrato. */
function voiced(f0: number, ms: number, amp = 0.3, seed = 1): Int16Array {
  const n = Math.round((SR * ms) / 1000);
  const out = new Int16Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = f0 * (1 + 0.02 * Math.sin((2 * Math.PI * 5 * i) / SR + seed));
    phase += (2 * Math.PI * f) / SR;
    let s = 0;
    for (let h = 1; h <= 8; h++) s += Math.sin(h * phase) / h;
    out[i] = Math.round(amp * 0.5 * s * 32767);
  }
  return out;
}

function feed(est: VoiceGenderEstimator, pcm: Int16Array) {
  for (let i = 0; i + 320 <= pcm.length; i += 320) est.push(pcm.subarray(i, i + 320));
}

describe("voice-gender", () => {
  it("estimates pitch of typical male and female voices", () => {
    for (const f0 of [95, 120, 145, 185, 210, 250]) {
      const w = Float32Array.from(voiced(f0, 40), (v) => v / 32768);
      const est = estimatePitchHz(w);
      expect(est).not.toBeNull();
      expect(Math.abs((est as number) - f0) / f0).toBeLessThan(0.06);
    }
  });

  it("ignores silence", () => {
    expect(estimatePitchHz(new Float32Array(640))).toBeNull();
  });

  it("classifies male voices as male", () => {
    for (const f0 of [95, 115, 135, 150]) {
      const est = new VoiceGenderEstimator();
      feed(est, voiced(f0, 1500));
      expect(est.resolve()).toBe("male");
    }
  });

  it("classifies female voices as female", () => {
    for (const f0 of [175, 200, 230, 260]) {
      const est = new VoiceGenderEstimator();
      feed(est, voiced(f0, 1500));
      expect(est.resolve("male")).toBe("female");
    }
  });

  it("locks the decision so the voice never flips mid-call", () => {
    const est = new VoiceGenderEstimator();
    feed(est, voiced(115, 1500));
    expect(est.resolve()).toBe("male");
    feed(est, voiced(240, 3000));
    expect(est.resolve()).toBe("male");
  });

  it("decides from a short utterance when forced, then stays locked", () => {
    const est = new VoiceGenderEstimator();
    feed(est, voiced(220, 400));
    expect(est.resolve("male")).toBe("female");
    feed(est, voiced(110, 2000));
    expect(est.resolve()).toBe("female");
  });

  it("honours an explicit profile gender", () => {
    const est = new VoiceGenderEstimator("male");
    feed(est, voiced(230, 1500));
    expect(est.resolve()).toBe("male");
  });

  it("uses the median so a few outliers do not flip the result", () => {
    expect(classifyMedianPitch([110, 115, 120, 118, 400, 390])).toBe("male");
  });
});

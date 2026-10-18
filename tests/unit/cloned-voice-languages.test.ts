import { describe, expect, it } from "vitest";
import { canSpeakInClonedVoice } from "../../server/realtime-translation-core";

describe("canSpeakInClonedVoice", () => {
  it("speaks Indian languages in the caller's own voice, Telugu included", () => {
    for (const language of ["te", "te-IN", "hi", "ta", "kn", "ml", "bn", "mr", "gu", "pa", "or", "en-IN"]) {
      expect(canSpeakInClonedVoice(language)).toBe(true);
    }
  });

  it("falls back to the standard voice for a language the model cannot speak", () => {
    expect(canSpeakInClonedVoice("xx")).toBe(false);
  });
});

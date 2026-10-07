import { describe, it, expect } from "vitest";
import { computeNeedsTranslation } from "../../server/translation/translation-service";

// Calls: people who share a language hear each other directly; translation
// (and its speech-to-text cost) runs only when someone needs another language.
describe("computeNeedsTranslation", () => {
  it("1:1 call, same language: no translation", () => {
    expect(computeNeedsTranslation("te", [{ language: "te", mode: "voice" }])).toBe(false);
  });

  it("treats regional variants as the same language", () => {
    expect(computeNeedsTranslation("te-IN", [{ language: "te", mode: "voice" }])).toBe(false);
    expect(computeNeedsTranslation("en", [{ language: "EN-us", mode: "subtitles" }])).toBe(false);
  });

  it("1:1 call, different language: translate", () => {
    expect(computeNeedsTranslation("te", [{ language: "en", mode: "voice" }])).toBe(true);
  });

  it("group call: translate when at least one listener differs", () => {
    expect(computeNeedsTranslation("hi", [
      { language: "hi", mode: "voice" },
      { language: "hi", mode: "voice" },
      { language: "ta", mode: "voice" },
    ])).toBe(true);
  });

  it("group call: everyone shares the speaker's language", () => {
    expect(computeNeedsTranslation("hi", [
      { language: "hi", mode: "voice" },
      { language: "hi-IN", mode: "subtitles" },
    ])).toBe(false);
  });

  it("ignores listeners who turned translation off", () => {
    expect(computeNeedsTranslation("te", [{ language: "en", mode: "off" }])).toBe(false);
  });

  it("keeps listening while a language is unknown", () => {
    expect(computeNeedsTranslation("auto", [{ language: "te", mode: "voice" }])).toBe(true);
    expect(computeNeedsTranslation("te", [{ language: "auto", mode: "voice" }])).toBe(true);
  });

  it("nobody else in the room yet: nothing to do", () => {
    expect(computeNeedsTranslation("te", [])).toBe(false);
  });
});

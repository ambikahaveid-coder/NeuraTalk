import { describe, expect, it } from "vitest";
import { isListenerLanguageKnown } from "../../server/translation-target-rules";

describe("isListenerLanguageKnown", () => {
  it("knows a listener who chose a language", () => {
    expect(isListenerLanguageKnown("te", null, undefined)).toBe(true);
  });

  it("does not guess English for an auto listener who hasn't spoken yet", () => {
    expect(isListenerLanguageKnown("auto", null, undefined)).toBe(false);
    expect(isListenerLanguageKnown("auto", null, "unknown")).toBe(false);
  });

  it("knows an auto listener once their speech was detected", () => {
    expect(isListenerLanguageKnown("auto", "te", undefined)).toBe(true);
    expect(isListenerLanguageKnown("auto", null, "hi")).toBe(true);
  });
});

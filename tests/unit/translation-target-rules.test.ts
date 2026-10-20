import { describe, expect, it } from "vitest";
import { isListenerLanguageKnown, resolveListenerTarget } from "../../server/translation-target-rules";

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

describe("resolveListenerTarget", () => {
  it("translates two Telugu-profile callers when one actually speaks English", () => {
    // Speaker said a Telugu sentence; the listener has been speaking English.
    expect(resolveListenerTarget({ sourceLanguage: "te", listenerProfileLanguage: "te", listenerSpokenLanguage: "en" }))
      .toEqual({ targetLanguage: "en", translationActive: true });
  });

  it("does not translate when both people actually speak the same language, whatever their profiles say", () => {
    expect(resolveListenerTarget({ sourceLanguage: "te", listenerProfileLanguage: "en", listenerSpokenLanguage: "te" }))
      .toEqual({ targetLanguage: "te", translationActive: false });
  });

  it("uses the listener's profile language until they have spoken", () => {
    expect(resolveListenerTarget({ sourceLanguage: "te", listenerProfileLanguage: "en" }))
      .toEqual({ targetLanguage: "en", translationActive: true });
    expect(resolveListenerTarget({ sourceLanguage: "te-IN", listenerProfileLanguage: "te" }))
      .toEqual({ targetLanguage: "te", translationActive: false });
  });

  it("leaves an auto listener who hasn't spoken on the speaker's own voice", () => {
    expect(resolveListenerTarget({ sourceLanguage: "te", listenerProfileLanguage: "auto" })).toBeNull();
    expect(resolveListenerTarget({ sourceLanguage: "te", listenerProfileLanguage: "auto", runtimeDetectedLanguage: "unknown" })).toBeNull();
  });
});

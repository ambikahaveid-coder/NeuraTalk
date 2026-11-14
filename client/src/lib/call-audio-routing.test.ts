import { describe, expect, it } from "vitest";
import { decideAudioRouting, translatedSpeakerFor } from "./call-audio-routing";

const me = "user-3";
const forMeFromCaller = `translated-for-${me}-from-user-1`;
const forCallerFromMe = `translated-for-user-1-from-${me}`;

describe("translatedSpeakerFor", () => {
  it("returns the speaker for a track meant for this listener", () => {
    expect(translatedSpeakerFor(forMeFromCaller, me)).toBe("user-1");
  });

  it("ignores tracks meant for someone else", () => {
    expect(translatedSpeakerFor(forCallerFromMe, me)).toBeNull();
    expect(translatedSpeakerFor(undefined, me)).toBeNull();
  });

  it("decodes URL-encoded identities", () => {
    expect(translatedSpeakerFor("translated-for-a%20b-from-c%2Bd", "a b")).toBe("c+d");
  });
});

describe("who counts as the translator", () => {
  it("the translator is a bot; the AI assistant is a person on the call (heard, and the call counts as answered)", async () => {
    const { isTranslatorBotParticipant } = await import("@/hooks/use-livekit-call");
    expect(isTranslatorBotParticipant({ identity: "neuratalk-translator", metadata: "" })).toBe(true);
    expect(isTranslatorBotParticipant({ identity: "x", metadata: JSON.stringify({ role: "bot" }) })).toBe(true);
    expect(isTranslatorBotParticipant({ identity: "assistant-personal-7", metadata: JSON.stringify({ role: "assistant", assistant: true }) })).toBe(false);
  });
});

describe("decideAudioRouting", () => {
  const caller = { participantIdentity: "user-1", isBot: false };

  it("keeps original voice until translated speech is confirmed", () => {
    expect(decideAudioRouting([caller, { participantIdentity: "neuratalk-translator", isBot: true, trackName: forMeFromCaller, translationReady: false }], me, true)).toEqual([true, false]);
  });

  it("plays translation after translated speech is confirmed", () => {
    const routing = decideAudioRouting(
      [caller, { participantIdentity: "neuratalk-translator", isBot: true, trackName: forMeFromCaller, translationReady: true }],
      me,
      true,
    );
    expect(routing).toEqual([false, true]);
  });

  it("keeps the original voice when no translation track has arrived yet", () => {
    expect(decideAudioRouting([caller], me, true)).toEqual([true]);
  });

  it("plays only the original voice outside voice mode", () => {
    const routing = decideAudioRouting(
      [caller, { participantIdentity: "neuratalk-translator", isBot: true, trackName: forMeFromCaller, translationReady: true }],
      me,
      false,
    );
    expect(routing).toEqual([true, false]);
  });

  it("plays the other person's AI assistant (it is the one answering), with or without voice translation", () => {
    const assistant = { participantIdentity: "assistant-personal-7", isBot: false, trackName: "assistant-voice" };
    expect(decideAudioRouting([assistant], me, true)).toEqual([true]);
    expect(decideAudioRouting([assistant], me, false)).toEqual([true]);
    expect(decideAudioRouting([assistant, { participantIdentity: "neuratalk-translator", isBot: true, trackName: forCallerFromMe, translationReady: true }], me, true)).toEqual([true, false]);
  });

  it("never plays the listener's own words translated back", () => {
    const routing = decideAudioRouting(
      [caller, { participantIdentity: "neuratalk-translator", isBot: true, trackName: forCallerFromMe, translationReady: true }],
      me,
      true,
    );
    expect(routing).toEqual([true, false]);
  });
});

import { describe, it, expect } from "vitest";
import { isTranslationConsentDenied } from "../../server/translation-consent";

/**
 * P0-4: users.consentTranslation was written by /api/compliance/consent but
 * never read anywhere -- translation ran through Sarvam/Azure/OpenAI/
 * ElevenLabs regardless of its value. Now enforced via a single shared
 * predicate (isTranslationConsentDenied), called BEFORE any provider is
 * invoked, at all three chat-translation entry points: personal chat text
 * send (server/personal-chat-routes.ts), group chat text send, and group
 * chat voice-message processing (both in server/group-chats.ts).
 *
 * Opt-out semantics were an explicit product decision (see
 * server/translation-consent.ts's comment): consentTranslation defaults to
 * false and no existing user has ever set it, so only an EXPLICIT false
 * blocks translation -- unset/true both pass. This avoids silently
 * disabling translation for the entire existing user base on deploy.
 */

describe("P0-4: isTranslationConsentDenied predicate", () => {
  it("1. consent explicitly false -> denied (providers must not be called)", () => {
    expect(isTranslationConsentDenied(false)).toBe(true);
  });

  it("2. consent explicitly true -> not denied (providers called normally)", () => {
    expect(isTranslationConsentDenied(true)).toBe(false);
  });

  it("unset (undefined, the real-world default for every existing user) -> not denied (opt-out semantics)", () => {
    expect(isTranslationConsentDenied(undefined)).toBe(false);
  });

  it("null (defensive -- some query paths could plausibly return null) -> not denied", () => {
    expect(isTranslationConsentDenied(null)).toBe(false);
  });
});

describe("P0-4: consent gate is wired BEFORE any provider call at all three chat entry points", () => {
  it("personal-chat-routes.ts gates the translatePersonalText calls behind translationConsentDenied", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve(__dirname, "../../server/personal-chat-routes.ts"), "utf8");

    const gateIdx = source.indexOf("const translationConsentDenied = isTranslationConsentDenied(");
    const firstProviderCallIdx = source.indexOf("await translatePersonalText(");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(firstProviderCallIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(firstProviderCallIdx);

    // The if-condition guarding the translation block must reference the
    // consent flag, not just the pre-existing translationEnabled toggle.
    const ifBlockStart = source.indexOf("if (senderRow?.translationEnabled !== false");
    expect(ifBlockStart).toBeGreaterThan(-1);
    const ifLine = source.slice(ifBlockStart, source.indexOf("\n", ifBlockStart));
    expect(ifLine).toContain("translationConsentDenied");
  });

  it("group-chats.ts gates the TEXT-message translateText loop behind groupTranslationConsentDenied", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve(__dirname, "../../server/group-chats.ts"), "utf8");

    const textRouteIdx = source.indexOf('router.post("/api/group-chats/:groupId/messages"');
    const voiceRouteIdx = source.indexOf('router.post("/api/group-chats/:groupId/voice-messages"');
    const textRouteBody = source.slice(textRouteIdx, voiceRouteIdx);

    expect(textRouteBody).toContain("groupTranslationConsentDenied");
    const gateIdx = textRouteBody.indexOf("groupTranslationConsentDenied = isTranslationConsentDenied(");
    const providerCallIdx = textRouteBody.indexOf("await translateText(");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(providerCallIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(providerCallIdx);
  });

  it("group-chats.ts gates the VOICE-message translation loop (processVoiceMessage) behind voiceTranslationConsentDenied -- a separate route, so consent can't be bypassed by switching to voice", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve(__dirname, "../../server/group-chats.ts"), "utf8");

    const fnIdx = source.indexOf("async function processVoiceMessage(");
    expect(fnIdx).toBeGreaterThan(-1);
    const fnBody = source.slice(fnIdx);

    expect(fnBody).toContain("voiceTranslationConsentDenied");
    const gateIdx = fnBody.indexOf("voiceTranslationConsentDenied = isTranslationConsentDenied(");
    const providerCallIdx = fnBody.indexOf("await translateText(");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(providerCallIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(providerCallIdx);
  });

  it("3. provider-failure fail-open behavior in translatePersonalText is untouched -- the try/catch chain still ends by returning the original text, not throwing or fabricating a translation", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve(__dirname, "../../server/personal-chat-routes.ts"), "utf8");
    const fnIdx = source.indexOf("async function translatePersonalText(");
    const fnEndIdx = source.indexOf("\nasync function resolveRecipientUser", fnIdx);
    const fnBody = source.slice(fnIdx, fnEndIdx);
    // The final catch of the final fallback (elevenlabs) must return the
    // original `text`, not throw or return an empty/fabricated string.
    expect(fnBody).toMatch(/catch\s*\{\s*return text;\s*\}/);
  });
});

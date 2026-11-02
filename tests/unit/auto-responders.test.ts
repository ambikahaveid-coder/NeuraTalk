import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

const { keywordMatches, normalizeForMatch, pickResponder, renderReply, responderSchema } = await import("../../server/modules/messaging/auto-responders");

const r = (id: number, keywords: string[], extra: Partial<{ trigger_type: string; match_type: string; priority: number }> = {}) => ({
  id, keywords, trigger_type: "keyword", match_type: "contains", priority: 100, ...extra,
});

describe("auto-responder matching", () => {
  it("normalizes case, spaces, punctuation and zero-width characters", () => {
    expect(normalizeForMatch("  PRICE?? ")).toBe("price");
    expect(normalizeForMatch("Price​  list!")).toBe("price list");
  });

  it("contains matches whole words only", () => {
    expect(keywordMatches("What is the price?", "price", "contains")).toBe(true);
    expect(keywordMatches("this is it", "hi", "contains")).toBe(false);
    expect(keywordMatches("hi there", "hi", "contains")).toBe(true);
    expect(keywordMatches("send price list please", "price list", "contains")).toBe(true);
  });

  it("works with Telugu and Hindi keywords", () => {
    expect(keywordMatches("కాజు బర్ఫీ ధర ఎంత", "ధర", "contains")).toBe(true);
    expect(keywordMatches("कीमत बताओ", "कीमत", "contains")).toBe(true);
  });

  it("exact and starts_with", () => {
    expect(keywordMatches("Menu", "menu", "exact")).toBe(true);
    expect(keywordMatches("menu please", "menu", "exact")).toBe(false);
    expect(keywordMatches("menu please", "menu", "starts_with")).toBe(true);
    expect(keywordMatches("show menu", "menu", "starts_with")).toBe(false);
  });

  it("treats regex characters in keywords as plain text", () => {
    expect(keywordMatches("is c++ available", "c++", "contains")).toBe(true);
    expect(keywordMatches("anything", ".*", "contains")).toBe(false);
  });

  it("picks the highest priority, then the oldest", () => {
    const list = [r(1, ["price"]), r(2, ["price"], { priority: 200 }), r(3, ["price"], { priority: 200 })];
    expect(pickResponder(list, { text: "price?" })?.responder.id).toBe(2);
    expect(pickResponder(list, { text: "hello" })).toBeNull();
  });

  it("button responders react to the tapped button, not to typed text", () => {
    const list = [r(1, ["order"], { trigger_type: "button" })];
    expect(pickResponder(list, { text: "I want to order" })).toBeNull();
    expect(pickResponder(list, { text: "Order now", buttonId: "order" })?.responder.id).toBe(1);
  });
});

describe("auto-responder reply and validation", () => {
  it("fills {{name}} and {{first_name}}, with a fallback", () => {
    expect(renderReply("Hi {{first_name}}!", { name: "Ravi Kumar" })).toBe("Hi Ravi!");
    expect(renderReply("Hi {{ name }}", { name: "Ravi Kumar" })).toBe("Hi Ravi Kumar");
    expect(renderReply("Hi {{name}}", { name: null })).toBe("Hi there");
    expect(renderReply("Hi {{first_name}}!", { name: "+91 55555 00603" })).toBe("Hi there!");
    expect(renderReply("Hi {{first_name}}", { name: "రవి" })).toBe("Hi రవి");
  });

  it("validates input and removes duplicate keywords", () => {
    const ok = responderSchema.parse({ name: "Prices", keywords: ["price", "price", "rate"], replyText: "Rs 450" });
    expect(ok.keywords).toEqual(["price", "rate"]);
    expect(ok.matchType).toBe("contains");
    expect(responderSchema.safeParse({ name: "x", keywords: [], replyText: "" }).success).toBe(false);
    expect(responderSchema.safeParse({ name: "Too many", keywords: ["a"], replyText: "b",
      buttons: [1, 2, 3, 4].map((i) => ({ type: "quick_reply", id: `b${i}`, title: `B${i}` })) }).success).toBe(false);
  });
});

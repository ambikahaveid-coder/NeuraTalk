import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A broadcast stores one message per customer. The same text in the same language must be
 * translated once (shared cache), not once per customer.
 */
const store = new Map<string, string>();
const translate = vi.fn(async (text: string, lang: string) => `[${lang}] ${text}`);
const inserted: any[] = [];

vi.mock("../../server/redis", () => ({
  isRedisReady: () => true,
  getRedisClient: () => ({
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => { store.set(k, v); return "OK"; },
  }),
}));
vi.mock("../../server/translation/chat-translate", () => ({ translateChatTextToLanguage: (t: string, l: string) => translate(t, l) }));
vi.mock("../../server/translation-consent", () => ({ isTranslationConsentDenied: () => false }));
vi.mock("../../server/observability", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: async (v: any) => { inserted.push(v); } }),
  },
}));

describe("business translation shared cache", () => {
  beforeEach(() => { store.clear(); translate.mockClear(); inserted.length = 0; });

  it("translates the same broadcast text once for many customers", async () => {
    const { withTranslations } = await import("../../server/modules/messaging/translate");
    const text = "Festival sale: 20% off this weekend";
    // Three customers each open their own copy of the same broadcast.
    for (const id of [101, 102, 103]) {
      const [m] = await withTranslations([{ id, content: text, category: "marketing" }], "te", () => false);
      expect(m.translatedContent).toBe(`[te] ${text}`);
    }
    expect(translate).toHaveBeenCalledTimes(1);
    expect(inserted.map((r) => r.messageId)).toEqual([101, 102, 103]);
  });

  it("different text or language is translated separately", async () => {
    const { withTranslations } = await import("../../server/modules/messaging/translate");
    await withTranslations([{ id: 1, content: "Hi Ravi, your order A-1 is packed", category: "utility" }], "te", () => false);
    await withTranslations([{ id: 2, content: "Hi Sita, your order A-2 is packed", category: "utility" }], "te", () => false);
    await withTranslations([{ id: 3, content: "Hi Ravi, your order A-1 is packed", category: "utility" }], "hi", () => false);
    expect(translate).toHaveBeenCalledTimes(3);
  });

  it("never translates verification codes", async () => {
    const { withTranslations } = await import("../../server/modules/messaging/translate");
    const [m] = await withTranslations([{ id: 9, content: "Your code is 482913", category: "authentication" }], "te", () => false);
    expect(m.translatedContent).toBeNull();
    expect(translate).not.toHaveBeenCalled();
  });
});

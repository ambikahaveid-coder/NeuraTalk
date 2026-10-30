import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/redis", () => ({ getRedisClient: () => ({}), isRedisReady: () => false }));
vi.mock("../../server/role-middleware", () => ({ requireAuth: () => undefined }));

describe("link previews", () => {
  it("reads Open Graph tags in either attribute order and decodes entities", async () => {
    const { parsePreview } = await import("../../server/link-preview");
    const html = `<html><head>
      <meta property="og:title" content="Diwali Sale &amp; Offers">
      <meta content="Up to 50% off on sarees" name="description">
      <meta property="og:image" content="/img/banner.jpg">
      <meta property="og:site_name" content="Sri Lakshmi">
      <title>ignored</title></head></html>`;
    const p = parsePreview(html, new URL("https://shop.example.com/sale"));
    expect(p.title).toBe("Diwali Sale & Offers");
    expect(p.description).toBe("Up to 50% off on sarees");
    expect(p.image).toBe("https://shop.example.com/img/banner.jpg");
    expect(p.siteName).toBe("Sri Lakshmi");
  });

  it("falls back to <title> and the host name; drops non-https images", async () => {
    const { parsePreview } = await import("../../server/link-preview");
    const p = parsePreview(`<title> My page </title><meta property="og:image" content="http://x.test/a.png">`, new URL("https://www.example.org/x"));
    expect(p.title).toBe("My page");
    expect(p.image).toBeNull();
    expect(p.siteName).toBe("example.org");
  });

  it("refuses anything that is not a public https page (SSRF)", async () => {
    const { fetchLinkPreview } = await import("../../server/link-preview");
    expect(await fetchLinkPreview("http://example.com")).toBeNull();
    expect(await fetchLinkPreview("https://user:pw@example.com")).toBeNull();
    await expect(fetchLinkPreview("https://127.0.0.1/")).rejects.toThrow();
    await expect(fetchLinkPreview("https://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(fetchLinkPreview("https://10.0.0.5/")).rejects.toThrow();
    await expect(fetchLinkPreview("https://localhost/")).rejects.toThrow();
  });
});

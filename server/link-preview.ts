/**
 * Link previews for chat messages: title, description, picture and site
 * name of an https page, read from its Open Graph / <title> tags.
 *
 * The server fetches pages people paste, so it is an SSRF risk. Every hop
 * (including each redirect) is resolved and checked with the same rules as
 * webhooks (no private, loopback, link-local or cloud-metadata addresses),
 * and the checked address is pinned to the connection so DNS can't rebind.
 * HTTPS only, 3 redirects, 5 s, 512 KB, HTML only. Results cached 24 h.
 */
import type { Express, Request, Response } from "express";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { isDisallowedIp } from "./modules/webhooks/service";
import { requireAuth } from "./role-middleware";
import { getRedisClient, isRedisReady } from "./redis";

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const CACHE_SECONDS = 24 * 60 * 60;
const memoryCache = new Map<string, { at: number; value: LinkPreview | null }>();

async function safeAddress(hostname: string): Promise<{ address: string; family: number }> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) throw new Error("disallowed host");
  if (isIP(host)) {
    if (isDisallowedIp(host)) throw new Error("disallowed host");
    return { address: host, family: isIP(host) };
  }
  const addresses = await dnsLookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((a) => isDisallowedIp(a.address))) throw new Error("disallowed host");
  return addresses[0];
}

function fetchOnce(url: URL, pinned: { address: string; family: number }): Promise<{ status: number; location?: string; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "GET",
      timeout: TIMEOUT_MS,
      headers: {
        "user-agent": "NeuraTalkLinkPreview/1.0 (+https://neuratalk.in)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en",
      },
      // Connect only to the address that was checked above.
      lookup: (_hostname, options, callback) => {
        const cb = callback as unknown as (err: Error | null, address: string | Array<{ address: string; family: number }>, family?: number) => void;
        if ((options as { all?: boolean })?.all) cb(null, [pinned]);
        else cb(null, pinned.address, pinned.family);
      },
    }, (res) => {
      const status = res.statusCode ?? 0;
      const contentType = String(res.headers["content-type"] ?? "");
      if (status >= 300 && status < 400) {
        res.resume();
        return resolve({ status, location: res.headers.location, contentType, body: "" });
      }
      if (!/text\/html|application\/xhtml/i.test(contentType)) {
        res.resume();
        return resolve({ status, contentType, body: "" });
      }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("close", () => resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, key: string): string | null {
  // <meta property="og:title" content="..."> in either attribute order.
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i").exec(html);
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i").exec(html);
  const value = (a?.[1] ?? b?.[1])?.trim();
  return value ? decodeEntities(value) : null;
}

export function parsePreview(html: string, pageUrl: URL): Omit<LinkPreview, "url"> {
  const head = html.slice(0, 200_000);
  const title = metaContent(head, "og:title") ?? metaContent(head, "twitter:title")
    ?? (/<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1] ? decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(head)![1]) : null);
  const description = metaContent(head, "og:description") ?? metaContent(head, "description") ?? metaContent(head, "twitter:description");
  let image = metaContent(head, "og:image") ?? metaContent(head, "twitter:image");
  if (image) {
    try {
      const resolved = new URL(image, pageUrl);
      image = resolved.protocol === "https:" ? resolved.toString() : null;
    } catch {
      image = null;
    }
  }
  return {
    title: title ? title.slice(0, 200) : null,
    description: description ? description.slice(0, 300) : null,
    image,
    siteName: metaContent(head, "og:site_name")?.slice(0, 80) ?? pageUrl.hostname.replace(/^www\./, ""),
  };
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const pinned = await safeAddress(url.hostname);
    const res = await fetchOnce(url, pinned);
    if (res.status >= 300 && res.status < 400 && res.location) {
      const next = new URL(res.location, url);
      if (next.protocol !== "https:") return null;
      url = next;
      continue;
    }
    if (res.status !== 200 || !res.body) return null;
    const preview = parsePreview(res.body, url);
    if (!preview.title && !preview.description) return null;
    return { url: rawUrl, ...preview };
  }
  return null;
}

async function cached(rawUrl: string): Promise<LinkPreview | null> {
  const key = `linkpreview:${createHash("sha1").update(rawUrl).digest("hex")}`;
  const mem = memoryCache.get(key);
  if (mem && Date.now() - mem.at < CACHE_SECONDS * 1000) return mem.value;
  if (isRedisReady()) {
    try {
      const hit = await getRedisClient().get(key);
      if (hit) return JSON.parse(hit) as LinkPreview | null;
    } catch { /* fetch below */ }
  }
  let value: LinkPreview | null = null;
  try {
    value = await fetchLinkPreview(rawUrl);
  } catch {
    value = null; // unsafe/unreachable pages simply have no preview
  }
  memoryCache.set(key, { at: Date.now(), value });
  if (memoryCache.size > 500) memoryCache.delete(memoryCache.keys().next().value as string);
  if (isRedisReady()) {
    try {
      await getRedisClient().set(key, JSON.stringify(value), "EX", CACHE_SECONDS);
    } catch { /* memory cache still has it */ }
  }
  return value;
}

// Per-person cap: previews are cheap for people but not for a script.
const perUser = new Map<number, { windowStart: number; count: number }>();
function allow(userId: number): boolean {
  const now = Date.now();
  const entry = perUser.get(userId);
  if (!entry || now - entry.windowStart > 60_000) {
    perUser.set(userId, { windowStart: now, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= 60;
}

export function registerLinkPreviewRoutes(app: Express): void {
  app.get("/api/link-preview", requireAuth, async (req: Request, res: Response) => {
    const raw = typeof req.query.url === "string" ? req.query.url.trim() : "";
    if (!raw || raw.length > 2000) return res.status(400).json({ error: "A link is required." });
    if (!allow(req.user!.id)) return res.status(429).json({ error: "Too many previews. Try again in a minute." });
    const preview = await cached(raw);
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.json({ preview });
  });
}

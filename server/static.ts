import express, { type Express, type Request, type Response, type NextFunction } from "express";
import fs from "fs";
import path from "path";
import zlib from "zlib";

const COMPRESSIBLE = /\.(js|mjs|css|html|json|svg|txt|xml|map)$/i;

// Only Vite's content-hashed files may be cached forever. Everything else
// (index.html, sw.js, audio worklets, manifest, icons) keeps its name across
// deploys, so browsers must revalidate it or visitors get a stale app.
function cacheControlFor(filePath: string): string {
  const rel = filePath.replace(/\\/g, "/");
  if (rel.includes("/assets/")) return "public, max-age=31536000, immutable";
  if (/\.(png|jpe?g|webp|ico|woff2?)$/i.test(rel)) return "public, max-age=86400";
  return "no-cache";
}

// The bundle was served uncompressed (575 KB main script). Compress each
// static text file once, keep the result in memory, and serve it to every
// browser that accepts it.
function precompressed(distPath: string) {
  const cache = new Map<string, { body: Buffer; encoding: string; mtime: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let urlPath: string;
    try { urlPath = decodeURIComponent(req.path); } catch { return next(); }
    // Website pages ("/", "/pricing", "/calls/b2b") are all the app shell.
    const isPageRoute = !/^\/(api|ws|assets)(\/|$)/.test(urlPath) && !path.posix.basename(urlPath).includes(".");
    if (isPageRoute) urlPath = "/index.html";
    if (!COMPRESSIBLE.test(urlPath)) return next();
    const filePath = path.join(distPath, urlPath);
    if (!filePath.startsWith(distPath + path.sep)) return next();
    const accept = String(req.headers["accept-encoding"] || "");
    const encoding = /\bbr\b/.test(accept) ? "br" : /\bgzip\b/.test(accept) ? "gzip" : null;
    if (!encoding) return next();
    let stat: fs.Stats;
    try { stat = fs.statSync(filePath); } catch { return next(); }
    if (!stat.isFile() || stat.size < 1024) return next();
    const key = `${encoding}:${filePath}`;
    let hit = cache.get(key);
    if (!hit || hit.mtime !== stat.mtimeMs) {
      const raw = fs.readFileSync(filePath);
      const body = encoding === "br"
        ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } })
        : zlib.gzipSync(raw, { level: 9 });
      hit = { body, encoding, mtime: stat.mtimeMs };
      cache.set(key, hit);
    }
    res.setHeader("Content-Encoding", hit.encoding);
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Content-Length", String(hit.body.length));
    res.setHeader("Cache-Control", cacheControlFor(filePath));
    res.setHeader("Last-Modified", stat.mtime.toUTCString());
    res.type(path.extname(filePath));
    if (req.fresh) return res.status(304).end();
    if (req.method === "HEAD") return res.end();
    res.end(hit.body);
  };
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(precompressed(distPath));
  app.use(express.static(distPath, {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => res.setHeader("Cache-Control", cacheControlFor(filePath)),
  }));

  // fall through to index.html if the file doesn't exist (skip API routes)
  app.use("*", (req, res) => {
    // "/api-docs" is a website page, so match the "/api/" prefix only.
    if (/^\/(api|ws)(\/|\?|$)/.test(req.originalUrl)) {
      return res.status(404).json({ error: "Not found", path: req.originalUrl });
    }
    // A missing hashed bundle is a real 404, not the app shell; serving HTML
    // as JavaScript leaves a blank page after a deploy.
    if (req.originalUrl.startsWith("/assets/")) {
      return res.status(404).type("text/plain").send("Not found");
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

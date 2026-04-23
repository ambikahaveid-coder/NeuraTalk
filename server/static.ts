import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Added aggressive caching for production assets to ensure "smooth" feel
  app.use(express.static(distPath, {
    maxAge: '1y',
    etag: true,
    lastModified: true,
    setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  }));

  // fall through to index.html if the file doesn't exist (skip API routes)
  app.use("*", (req, res) => {
    if (req.originalUrl.startsWith("/api") || req.originalUrl.startsWith("/ws")) {
      return res.status(404).json({ error: "Not found", path: req.originalUrl });
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

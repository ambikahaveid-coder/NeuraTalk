#!/usr/bin/env node
// One-off, standalone verification (not part of the vitest suite — see
// tests/integration/async-crash-prevention.test.ts for why) that the
// "unhandled async rejection crashes the process" P0 was real before the
// fix, and is closed after it. Run with:
//   node scripts/verify-async-crash-fix.mjs            (reproduces the bug)
//   node scripts/verify-async-crash-fix.mjs --fixed    (proves the fix)
import express from "express";

const fixed = process.argv.includes("--fixed");
if (fixed) {
  await import("express-async-errors");
}

const app = express();

// The exact vulnerable shape confirmed in server/routes.ts:454-460 — a bare
// async handler with no try/catch around a call that can reject.
app.get("/api/organizations", async (_req, res) => {
  const orgs = await simulateDbFailure();
  res.json(orgs);
});

app.use((err, _req, res, _next) => {
  res.status(500).json({ message: String(err && err.message || err) });
});

async function simulateDbFailure() {
  throw new Error("simulated database failure");
}

let unhandledRejectionFired = false;
process.on("unhandledRejection", (reason) => {
  unhandledRejectionFired = true;
  console.log(`[${fixed ? "FIXED" : "BEFORE FIX"}] unhandledRejection fired: ${reason}`);
  console.log(`[${fixed ? "FIXED" : "BEFORE FIX"}] a real production process would call shutdownServer(1) here — the whole server would go down.`);
});

const server = app.listen(0, async () => {
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/organizations`, { signal: AbortSignal.timeout(2000) });
    console.log(`[${fixed ? "FIXED" : "BEFORE FIX"}] HTTP response status: ${res.status}`);
  } catch (err) {
    console.log(`[${fixed ? "FIXED" : "BEFORE FIX"}] request never completed (client-side timeout) — the server dropped it entirely: ${err.name}`);
  }

  // Give the microtask/macrotask queue a moment to surface any
  // unhandledRejection triggered by the request above before we report.
  await new Promise((resolve) => setTimeout(resolve, 200));

  console.log(`[${fixed ? "FIXED" : "BEFORE FIX"}] RESULT: unhandledRejectionFired=${unhandledRejectionFired}`);
  server.close(() => process.exit(unhandledRejectionFired && !fixed ? 0 : (unhandledRejectionFired ? 1 : 0)));
});

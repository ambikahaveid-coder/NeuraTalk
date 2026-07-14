import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // Several test files import server modules that transitively pull in a
    // large dependency graph (db, express, provider SDKs); the first import
    // in a file pays a real cold-transform cost that occasionally exceeds
    // vitest's 5s default under parallel load. Global bump instead of
    // per-test workarounds scattered across files.
    testTimeout: 30_000,
    // Run test files sequentially rather than in parallel worker threads —
    // several files independently pay a real cold-transform cost on first
    // import, and running them concurrently under this sandbox's resource
    // constraints was causing that cost to spike past even a generous
    // per-test timeout. Slower wall-clock time, but reliable.
    fileParallelism: false,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: [
        "server/voice-training.ts", "server/voice-cloning-service.ts", "server/storage.ts",
        "server/pstn/registry.ts", "server/pstn/inbound.ts",
        "server/modules/transcripts/**/*.ts",
        "server/payment-service.ts", "server/payment-routes.ts",
        "server/request-context.ts", "server/http-metrics-middleware.ts",
        "server/reliability-monitor.ts", "server/payment-metrics.ts",
        "server/voice-clone-metrics.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});

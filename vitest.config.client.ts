import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Separate config for frontend component tests -- Phase 8B Marketing
 * Control Center (2026-08-24). The existing vitest.config.ts is
 * dedicated to the backend (environment: "node", server/tests globs
 * only) and is left untouched. No frontend test infrastructure existed
 * in this repo before this phase -- this file is that infrastructure,
 * scoped narrowly (jsdom + @testing-library/react) rather than folded
 * into the backend config.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./client/src/test/setup.ts"],
    include: ["client/src/**/*.test.tsx", "client/src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
});

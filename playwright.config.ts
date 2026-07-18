import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    navigationTimeout: 45_000,
    // The app registers a PWA service worker. It intercepts fetches at a
    // layer page.route() doesn't reliably control, so it can silently serve
    // cached/stale responses instead of our test mocks — this was the root
    // cause of the "waiting for navigation to finish" flakiness seen in
    // earlier E2E runs. Blocking it makes page.route() the only source of
    // truth for every request, which is what these tests assume.
    serviceWorkers: "block",
  },
  webServer: {
    // Production build served statically via `vite preview` — deliberately
    // NOT the dev server (HMR causes DOM-detach flakiness under Playwright)
    // and NOT the full Express app (server/index.ts), which requires a live
    // Postgres/Redis connection. All API calls in these E2E tests are
    // intercepted via page.route(), so no backend, database, or third-party
    // API is ever touched. Run `npx vite build` before this suite.
    command: "npx vite preview --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

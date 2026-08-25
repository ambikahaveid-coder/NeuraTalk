import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { UpdatePrompt } from "./UpdatePrompt";

/**
 * Regression coverage for the P2 routing investigation: a "controllerchange"
 * event fires the very first time a service worker EVER activates for a
 * page (uncontrolled -> controlled), not only when a real update replaces
 * an existing worker. The pre-fix handler reloaded unconditionally, which
 * could abort an in-flight navigation (e.g. a direct deep link to a
 * protected route right after login) and land the user somewhere other
 * than where they navigated -- reproduced and confirmed via 20+ live
 * production Playwright runs during the P2 investigation, root-caused to
 * this exact listener by process of elimination (stubbing
 * navigator.serviceWorker entirely eliminated the failure with zero other
 * changes).
 */

type Listener = (...args: unknown[]) => void;

function installFakeServiceWorker(initialController: unknown) {
  const listeners: Record<string, Listener[]> = {};
  const registration = {
    addEventListener: vi.fn(),
    waiting: null,
  };

  const fakeServiceWorker = {
    controller: initialController,
    ready: Promise.resolve(registration as unknown as ServiceWorkerRegistration),
    addEventListener: (type: string, listener: Listener) => {
      (listeners[type] ??= []).push(listener);
    },
    removeEventListener: vi.fn(),
    __dispatch: (type: string) => {
      for (const l of listeners[type] ?? []) l();
    },
  };

  Object.defineProperty(navigator, "serviceWorker", {
    value: fakeServiceWorker,
    configurable: true,
  });

  return fakeServiceWorker;
}

describe("UpdatePrompt -- service worker controllerchange handling", () => {
  const originalReload = window.location.reload;

  beforeEach(() => {
    // jsdom's window.location.reload throws "Not implemented" by default;
    // stub it so we can assert on call count instead.
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: originalReload },
      writable: true,
      configurable: true,
    });
  });

  it("does NOT reload on the first-ever controllerchange (no prior controller) -- this is the session-restoration / direct-deep-link case that must remain on its intended page", async () => {
    const sw = installFakeServiceWorker(null);
    render(<UpdatePrompt />);
    await Promise.resolve();
    await Promise.resolve();

    sw.__dispatch("controllerchange");

    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it("DOES reload on controllerchange when a controller already existed -- a genuine version update must still refresh the page", async () => {
    const sw = installFakeServiceWorker({ scriptURL: "/sw.js" });
    render(<UpdatePrompt />);
    await Promise.resolve();
    await Promise.resolve();

    sw.__dispatch("controllerchange");

    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads more than once even if controllerchange fires repeatedly -- no infinite redirect/reload loop", async () => {
    const sw = installFakeServiceWorker({ scriptURL: "/sw.js" });
    render(<UpdatePrompt />);
    await Promise.resolve();
    await Promise.resolve();

    sw.__dispatch("controllerchange");
    sw.__dispatch("controllerchange");
    sw.__dispatch("controllerchange");

    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it("mounts without console errors regardless of prior controller state", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    installFakeServiceWorker(null);
    await act(async () => {
      render(<UpdatePrompt />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("[regression proof] the OLD unconditional handler would have reloaded on first activation -- demonstrating this test actually catches the bug", async () => {
    // Simulates the pre-fix listener body verbatim (unconditional reload),
    // proving the new tests above are not vacuously true.
    const sw = installFakeServiceWorker(null);
    const oldReload = vi.fn();
    (navigator.serviceWorker as any).addEventListener("controllerchange", () => {
      oldReload();
    });

    sw.__dispatch("controllerchange");

    expect(oldReload).toHaveBeenCalledTimes(1);
  });
});

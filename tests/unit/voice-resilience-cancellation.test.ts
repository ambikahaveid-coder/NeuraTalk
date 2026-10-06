import { describe, it, expect } from "vitest";
import { runWithResilience, getProviderHealthSnapshot, createLinkedAbortController } from "../../server/voice-resilience";

const abortErr = () => Object.assign(new Error("Request was aborted."), { name: "AbortError" });
const health = (p: string) => getProviderHealthSnapshot().find((e) => e.provider === p);

describe("runWithResilience: caller cancellations are not provider failures", () => {
  it("many cancelled requests (newer partial transcript) never open the circuit", async () => {
    const provider = "test-cancel-" + Math.random();
    for (let i = 0; i < 12; i++) {
      const ctl = new AbortController();
      const p = runWithResilience(async (signal) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(abortErr()))), { provider, operation: "translate", signal: ctl.signal, timeoutMs: 5000 });
      ctl.abort();
      await expect(p).rejects.toThrow();
    }
    const ok = await runWithResilience(async () => "fine", { provider, operation: "translate" });
    expect(ok).toBe("fine");
    expect(health(provider)?.state).not.toBe("open");
  });

  it("real failures and deadline timeouts still open the circuit", async () => {
    const provider = "test-fail-" + Math.random();
    for (let i = 0; i < 10; i++) {
      const linked = createLinkedAbortController({ timeoutMs: 1, label: "t" });
      await new Promise((r) => setTimeout(r, 5));
      await runWithResilience(async () => { throw new Error("503"); }, { provider, operation: "translate", signal: linked.controller.signal }).catch(() => undefined);
      linked.cleanup();
    }
    expect(health(provider)?.state).toBe("open");
  });
});

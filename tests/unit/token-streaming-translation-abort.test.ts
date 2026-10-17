import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { ultraTranslateMock } = vi.hoisted(() => ({ ultraTranslateMock: vi.fn() }));

vi.mock("../../server/ultra-pipeline", () => ({
  getCachedTranslation: () => null,
  setCachedTranslation: vi.fn(),
  ultraTranslate: ultraTranslateMock,
}));

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The real OpenAI SDK talks to this local server, so a cancelled request
// fails with the SDK's own APIUserAbortError ("Request was aborted."),
// exactly as in production.
let respond: "hang" | "bad-request" = "hang";
const server: Server = createServer((req, res) => {
  req.resume();
  if (respond === "bad-request") {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "bad request", type: "invalid_request_error" } }));
  }
  // "hang": never answer, like a slow stream that is still in flight.
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.OPENAI_API_KEY = "test-key";
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

const { streamTranslationTokens } = await import("../../server/token-streaming-translation");

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe("streamTranslationTokens cancellation", () => {
  beforeEach(() => {
    ultraTranslateMock.mockReset();
    ultraTranslateMock.mockResolvedValue("namaste");
  });

  it("does not run the fallback translation when the caller cancels", async () => {
    respond = "hang";
    const controller = new AbortController();
    const onFallback = vi.fn();
    setTimeout(() => controller.abort(), 100);

    await expect(
      streamTranslationTokens("hello there", "en", "hi", { signal: controller.signal, onFallback }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(ultraTranslateMock).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("still falls back when OpenAI fails without a cancellation", async () => {
    respond = "bad-request";
    const onFallback = vi.fn();

    const result = await streamTranslationTokens("good morning", "en", "hi", {
      signal: new AbortController().signal,
      onFallback,
    });

    expect(result).toMatchObject({ provider: "fallback", finalText: "namaste" });
    expect(ultraTranslateMock).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith(expect.stringContaining("openai_stream_failed"));
  });
});

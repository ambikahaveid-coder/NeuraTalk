import { afterEach, describe, expect, it, vi } from "vitest";

describe("azureDeploymentFor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses the stronger deployment when either side speaks a listed language", async () => {
    vi.stubEnv("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini");
    vi.stubEnv("AZURE_OPENAI_DEPLOYMENT_BY_LANGUAGE", "ta:gpt-4o, kn:gpt-4o");
    const { azureDeploymentFor } = await import("../../server/token-streaming-translation");
    expect(azureDeploymentFor("en", "ta")).toBe("gpt-4o");
    expect(azureDeploymentFor("kn-IN", "en")).toBe("gpt-4o");
    expect(azureDeploymentFor("te", "en")).toBe("gpt-4.1-mini");
  });

  it("falls back to the default deployment without a map", async () => {
    vi.stubEnv("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini");
    vi.stubEnv("AZURE_OPENAI_DEPLOYMENT_BY_LANGUAGE", "");
    const { azureDeploymentFor } = await import("../../server/token-streaming-translation");
    expect(azureDeploymentFor("ta", "en")).toBe("gpt-4.1-mini");
  });
});

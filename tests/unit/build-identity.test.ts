import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const execFileSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

const { resolveBuildIdentity } = await import("../../script/build.mjs");

describe("resolveBuildIdentity", () => {
  const originalEnv = process.env.GIT_COMMIT_SHA;

  beforeEach(() => {
    execFileSyncMock.mockReset();
    delete process.env.GIT_COMMIT_SHA;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.GIT_COMMIT_SHA;
    else process.env.GIT_COMMIT_SHA = originalEnv;
  });

  it("CASE A: uses GIT_COMMIT_SHA when supplied, without calling git", () => {
    const fullSha = "a".repeat(40);
    process.env.GIT_COMMIT_SHA = fullSha;

    const { commitSha } = resolveBuildIdentity();

    expect(commitSha).toBe(fullSha);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("CASE B: falls back to git rev-parse HEAD when GIT_COMMIT_SHA is absent and git succeeds", () => {
    const fullSha = "b".repeat(40);
    execFileSyncMock.mockReturnValue(`${fullSha}\n`);

    const { commitSha } = resolveBuildIdentity();

    expect(commitSha).toBe(fullSha);
    expect(execFileSyncMock).toHaveBeenCalledWith("git", ["rev-parse", "HEAD"], expect.any(Object));
  });

  it('CASE C: returns "unknown" when GIT_COMMIT_SHA is absent and git is unavailable', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("git: command not found");
    });

    const { commitSha } = resolveBuildIdentity();

    expect(commitSha).toBe("unknown");
  });
});

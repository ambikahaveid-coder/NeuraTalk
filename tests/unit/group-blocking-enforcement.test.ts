import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * P0-3: group chat previously never checked blocking at all. Fixed via
 * isSenderBlockedInGroup (exported from server/group-chats.ts), called from
 * both group message-creation routes (text + voice) before either inserts a
 * row.
 *
 * DIRECTIONAL, not symmetric: uses hasBlockedUser(blockerUserId,
 * blockedUserId) from server/blocking.ts, not the pre-existing isBlocked()
 * that personal 1:1 chat uses. This distinction matters and was caught by
 * an earlier version of this test failing -- personal chat's isBlocked() is
 * symmetric (a block silences both directions), which is correct for a 1:1
 * thread with no bystanders. Applied naively to a group, symmetric blocking
 * would also lock the BLOCKER out of the group merely for having blocked
 * one member -- but the product spec explicitly requires "A can still use
 * the group" after A blocks B. So isSenderBlockedInGroup only rejects the
 * BLOCKED party (whoever a member has blocked), never the blocker.
 *
 * These tests exercise the real isSenderBlockedInGroup function with a
 * mocked db (member list) and a controllable directional block-relationship
 * map, so the test proves the actual group-membership-iteration logic and
 * its directionality, not just that hasBlockedUser exists.
 */

type Member = { userId: number };
let fakeMembers: Member[] = [];
// directedBlocks: `${blockerUserId}:${blockedUserId}` -> blocked (one-way)
const directedBlocks = new Set<string>();
function directedKey(blockerUserId: number, blockedUserId: number) {
  return `${blockerUserId}:${blockedUserId}`;
}
function recordBlock(blockerUserId: number, blockedUserId: number) {
  directedBlocks.add(directedKey(blockerUserId, blockedUserId));
}

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => fakeMembers,
      }),
    }),
  },
}));

vi.mock("../../server/blocking", () => ({
  hasBlockedUser: vi.fn(async (blockerUserId: number, blockedUserId: number) =>
    directedBlocks.has(directedKey(blockerUserId, blockedUserId)),
  ),
}));

beforeEach(() => {
  fakeMembers = [];
  directedBlocks.clear();
  vi.clearAllMocks();
});

const GROUP_ID = 1;
const USER_A = 100; // blocker
const USER_B = 200; // blocked by A
const USER_C = 300; // unrelated member

describe("P0-3: isSenderBlockedInGroup (directional -- only the blocked party is rejected)", () => {
  it("1&2. A blocks B -> B attempting to send into a group containing A is rejected", async () => {
    fakeMembers = [{ userId: USER_A }, { userId: USER_B }, { userId: USER_C }];
    recordBlock(USER_A, USER_B); // A is the blocker, B is blocked

    const { isSenderBlockedInGroup } = await import("../../server/group-chats");
    const blockedForB = await isSenderBlockedInGroup(GROUP_ID, USER_B);
    expect(blockedForB).toBe(true);
  });

  it("3. A (the blocker) can still use/send in the group normally -- blocking someone does not cost the blocker their own access", async () => {
    fakeMembers = [{ userId: USER_A }, { userId: USER_B }, { userId: USER_C }];
    recordBlock(USER_A, USER_B);

    const { isSenderBlockedInGroup } = await import("../../server/group-chats");
    const blockedForA = await isSenderBlockedInGroup(GROUP_ID, USER_A);
    expect(blockedForA).toBe(false);
  });

  it("4. an unrelated member (C) with no block relationship to anyone is unaffected", async () => {
    fakeMembers = [{ userId: USER_A }, { userId: USER_B }, { userId: USER_C }];
    recordBlock(USER_A, USER_B);

    const { isSenderBlockedInGroup } = await import("../../server/group-chats");
    const blockedForC = await isSenderBlockedInGroup(GROUP_ID, USER_C);
    expect(blockedForC).toBe(false);
  });

  it("a ONE-WAY block only restricts the blocked party -- reversing who is queried does not also restrict the blocker (proves directionality, not symmetry)", async () => {
    fakeMembers = [{ userId: USER_A }, { userId: USER_B }];
    recordBlock(USER_B, USER_A); // B blocks A this time (reverse of the other tests)

    const { isSenderBlockedInGroup } = await import("../../server/group-chats");
    expect(await isSenderBlockedInGroup(GROUP_ID, USER_A)).toBe(true);  // A is blocked by B -> rejected
    expect(await isSenderBlockedInGroup(GROUP_ID, USER_B)).toBe(false); // B did the blocking -> unaffected
  });

  it("a MUTUAL block (both directions recorded) restricts both parties", async () => {
    fakeMembers = [{ userId: USER_A }, { userId: USER_B }];
    recordBlock(USER_A, USER_B);
    recordBlock(USER_B, USER_A);

    const { isSenderBlockedInGroup } = await import("../../server/group-chats");
    expect(await isSenderBlockedInGroup(GROUP_ID, USER_A)).toBe(true);
    expect(await isSenderBlockedInGroup(GROUP_ID, USER_B)).toBe(true);
  });

  it("a group with no block relationships among its members allows everyone", async () => {
    fakeMembers = [{ userId: USER_A }, { userId: USER_B }, { userId: USER_C }];
    // no recordBlock calls

    const { isSenderBlockedInGroup } = await import("../../server/group-chats");
    for (const uid of [USER_A, USER_B, USER_C]) {
      expect(await isSenderBlockedInGroup(GROUP_ID, uid)).toBe(false);
    }
  });

  it("does not false-positive on the sender's own membership row (self is skipped, not compared to self)", async () => {
    fakeMembers = [{ userId: USER_A }];
    const { isSenderBlockedInGroup } = await import("../../server/group-chats");
    expect(await isSenderBlockedInGroup(GROUP_ID, USER_A)).toBe(false);
  });
});

describe("P0-3: both message-creation routes call the same block check (no bypass route)", () => {
  it("server/group-chats.ts source wires isSenderBlockedInGroup into both the text and voice message POST routes", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../server/group-chats.ts"),
      "utf8",
    );
    const textRouteIdx = source.indexOf('router.post("/api/group-chats/:groupId/messages"');
    const voiceRouteIdx = source.indexOf('router.post("/api/group-chats/:groupId/voice-messages"');
    expect(textRouteIdx).toBeGreaterThan(-1);
    expect(voiceRouteIdx).toBeGreaterThan(-1);

    const nextRouteIdx = source.indexOf("router.", textRouteIdx + 1);
    const textRouteBody = source.slice(textRouteIdx, nextRouteIdx === -1 ? undefined : nextRouteIdx);
    expect(textRouteBody).toContain("isSenderBlockedInGroup(");

    const afterVoice = source.indexOf("router.", voiceRouteIdx + 1);
    const voiceRouteBody = source.slice(voiceRouteIdx, afterVoice === -1 ? undefined : afterVoice);
    expect(voiceRouteBody).toContain("isSenderBlockedInGroup(");
  });
});

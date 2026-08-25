import { describe, it, expect, beforeEach } from "vitest";
import {
  setObjectAclPolicy,
  canAccessObject,
  ObjectAccessGroupType,
  ObjectPermission,
  type ObjectAclPolicy,
} from "../../server/ai_integrations/object_storage/objectAcl";

/**
 * P0-1: chat attachments were previously finalized with visibility:"public",
 * meaning ANY request (including unauthenticated ones) could fetch a chat
 * attachment URL. The fix keeps them private and grants read access to the
 * sender (as ACL owner) and the recipient (via a new USER_LIST access-group
 * rule) -- see finalizeChatAttachment in server/personal-chat-routes.ts.
 *
 * These tests exercise the REAL objectAcl.ts functions (canAccessObject,
 * setObjectAclPolicy, the USER_LIST group type), not a re-implementation,
 * against a minimal in-memory fake object handle -- objectAcl.ts only
 * type-imports ObjectFileHandle, so a duck-typed fake is sufficient and
 * exercises the exact same code path production uses.
 */

class FakeObjectFileHandle {
  key = "uploads/fake-attachment";
  private metadata: Record<string, string> = {};
  async exists(): Promise<[boolean]> {
    return [true];
  }
  async getMetadata() {
    return [{ metadata: this.metadata }];
  }
  async setMetadata(update: { metadata: Record<string, string> }) {
    this.metadata = { ...this.metadata, ...update.metadata };
  }
}

// Mirrors exactly what finalizeChatAttachment() in personal-chat-routes.ts
// now sets -- private visibility + a USER_LIST rule scoped to the recipient.
function chatAttachmentPolicy(senderUserId: number, recipientUserId: number): ObjectAclPolicy {
  return {
    owner: String(senderUserId),
    visibility: "private",
    aclRules: [
      {
        group: { type: ObjectAccessGroupType.USER_LIST, id: JSON.stringify([String(recipientUserId)]) },
        permission: ObjectPermission.READ,
      },
    ],
  };
}

describe("P0-1: chat attachment ACL (USER_LIST private grant, not public)", () => {
  let file: FakeObjectFileHandle;
  const SENDER = 101;
  const RECIPIENT = 202;
  const STRANGER = 303;

  beforeEach(async () => {
    file = new FakeObjectFileHandle();
    await setObjectAclPolicy(file as any, chatAttachmentPolicy(SENDER, RECIPIENT));
  });

  it("1. sender (ACL owner) can access the attachment", async () => {
    const allowed = await canAccessObject({
      userId: String(SENDER),
      objectFile: file as any,
      requestedPermission: ObjectPermission.READ,
    });
    expect(allowed).toBe(true);
  });

  it("2. recipient (granted via USER_LIST rule) can access the attachment", async () => {
    const allowed = await canAccessObject({
      userId: String(RECIPIENT),
      objectFile: file as any,
      requestedPermission: ObjectPermission.READ,
    });
    expect(allowed).toBe(true);
  });

  it("3. group-scoped grant works for multiple authorized ids (group-chat-shaped policy)", async () => {
    const groupFile = new FakeObjectFileHandle();
    const member1 = 501, member2 = 502, member3 = 503;
    await setObjectAclPolicy(groupFile as any, {
      owner: String(member1),
      visibility: "private",
      aclRules: [
        {
          group: { type: ObjectAccessGroupType.USER_LIST, id: JSON.stringify([String(member2), String(member3)]) },
          permission: ObjectPermission.READ,
        },
      ],
    });
    for (const uid of [member1, member2, member3]) {
      const allowed = await canAccessObject({
        userId: String(uid),
        objectFile: groupFile as any,
        requestedPermission: ObjectPermission.READ,
      });
      expect(allowed).toBe(true);
    }
    const outsider = await canAccessObject({
      userId: "999",
      objectFile: groupFile as any,
      requestedPermission: ObjectPermission.READ,
    });
    expect(outsider).toBe(false);
  });

  it("4. an unrelated authenticated user (not owner, not in the grant list) is denied", async () => {
    const allowed = await canAccessObject({
      userId: String(STRANGER),
      objectFile: file as any,
      requestedPermission: ObjectPermission.READ,
    });
    expect(allowed).toBe(false);
  });

  it("5. an unauthenticated request (no userId) is denied -- this is the actual vulnerability being fixed", async () => {
    const allowed = await canAccessObject({
      userId: undefined,
      objectFile: file as any,
      requestedPermission: ObjectPermission.READ,
    });
    expect(allowed).toBe(false);
  });

  it("6. malformed/tampered USER_LIST group id (invalid JSON) fails closed, not open", async () => {
    const tamperedFile = new FakeObjectFileHandle();
    await setObjectAclPolicy(tamperedFile as any, {
      owner: String(SENDER),
      visibility: "private",
      aclRules: [
        { group: { type: ObjectAccessGroupType.USER_LIST, id: "not-valid-json{{{" }, permission: ObjectPermission.READ },
      ],
    });
    const allowed = await canAccessObject({
      userId: String(RECIPIENT),
      objectFile: tamperedFile as any,
      requestedPermission: ObjectPermission.READ,
    });
    expect(allowed).toBe(false);
  });

  it("regression: a policy with no aclRules and visibility:private still denies non-owners (old default-deny path unaffected)", async () => {
    const bareFile = new FakeObjectFileHandle();
    await setObjectAclPolicy(bareFile as any, { owner: String(SENDER), visibility: "private" });
    const allowed = await canAccessObject({
      userId: String(RECIPIENT),
      objectFile: bareFile as any,
      requestedPermission: ObjectPermission.READ,
    });
    expect(allowed).toBe(false);
  });
});

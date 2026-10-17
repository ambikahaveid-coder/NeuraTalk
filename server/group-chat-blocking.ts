import { eq } from "drizzle-orm";
import { db } from "./db";
import { hasBlockedUser } from "./blocking";
import { groupChatMembers } from "@shared/schema";

export async function isSenderBlockedInGroup(groupId: number, senderId: number): Promise<boolean> {
  const members = await db.select({ userId: groupChatMembers.userId })
    .from(groupChatMembers)
    .where(eq(groupChatMembers.groupChatId, groupId));

  for (const member of members) {
    if (member.userId === senderId) continue;
    if (await hasBlockedUser(member.userId, senderId)) return true;
  }

  return false;
}

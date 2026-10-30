/**
 * Photos, videos, documents and voice notes in business chats.
 *
 * Files are uploaded through the shared presigned flow (POST
 * /api/uploads/request-url) and stay private: when sent, the file's access
 * list is set to exactly this conversation's people -- the customer's
 * NeuraTalk account and the business's own team -- and only the uploader may
 * share a file.
 */
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { customers, messagingAttachments, users, MESSAGE_TYPE } from "@shared/schema";
import { ObjectStorageService } from "../../ai_integrations/object_storage/objectStorage";
import { getObjectAclPolicy, setObjectAclPolicy, ObjectAccessGroupType, ObjectPermission } from "../../ai_integrations/object_storage/objectAcl";

export const attachmentInputSchema = z.object({
  url: z.string().trim().min(1).max(2000).refine((v) => v.startsWith("/objects/"), "Upload the file first"),
  mimeType: z.string().trim().min(3).max(120).optional(),
  sizeBytes: z.number().int().positive().max(100 * 1024 * 1024).optional(),
  title: z.string().trim().min(1).max(240).optional(),
  durationSeconds: z.number().int().nonnegative().max(60 * 60).optional(),
});
export type AttachmentInput = z.infer<typeof attachmentInputSchema>;

export class AttachmentNotOwnedError extends Error {}

export function messageTypeFor(attachment: AttachmentInput, requested?: string): string {
  if (requested === MESSAGE_TYPE.VOICE) return MESSAGE_TYPE.VOICE;
  const mime = attachment.mimeType ?? "";
  if (mime.startsWith("image/")) return MESSAGE_TYPE.IMAGE;
  if (mime.startsWith("video/")) return MESSAGE_TYPE.VIDEO;
  if (mime.startsWith("audio/")) return MESSAGE_TYPE.VOICE;
  return MESSAGE_TYPE.DOCUMENT;
}

/** Text shown in lists/notifications when a file is sent without a caption. */
export function attachmentLabel(type: string, attachment: AttachmentInput): string {
  if (type === MESSAGE_TYPE.IMAGE) return "📷 Photo";
  if (type === MESSAGE_TYPE.VIDEO) return "🎬 Video";
  if (type === MESSAGE_TYPE.VOICE) return "🎤 Voice message";
  return `📄 ${attachment.title ?? "Document"}`;
}

/** Everyone who may open files in this business chat. */
async function conversationReaders(businessId: number, customerId: number | null): Promise<string[]> {
  const team = await db.select({ id: users.id }).from(users).where(eq(users.organizationId, businessId));
  const readers = new Set(team.map((u) => String(u.id)));
  if (customerId) {
    const [customer] = await db.select({ linkedUserId: customers.linkedUserId }).from(customers).where(eq(customers.id, customerId));
    if (customer?.linkedUserId) readers.add(String(customer.linkedUserId));
  }
  return Array.from(readers);
}

/** Grants this conversation's people read access. Only the uploader may share a file. */
export async function shareAttachment(uploaderUserId: number, businessId: number, customerId: number | null, objectPath: string): Promise<void> {
  const storage = new ObjectStorageService();
  const file = await storage.getObjectEntityFile(objectPath);
  const existing = await getObjectAclPolicy(file);
  const { mayClaimUpload } = await import("../../ai_integrations/object_storage/upload-owner");
  if ((existing && existing.owner !== String(uploaderUserId)) || (!existing && !(await mayClaimUpload(objectPath, uploaderUserId)))) {
    throw new AttachmentNotOwnedError("This file belongs to someone else.");
  }
  const readers = new Set(await conversationReaders(businessId, customerId));
  for (const rule of existing?.aclRules ?? []) {
    if (rule.group?.type === ObjectAccessGroupType.USER_LIST) {
      try { for (const id of JSON.parse(rule.group.id) as string[]) readers.add(String(id)); } catch { /* ignore */ }
    }
  }
  await setObjectAclPolicy(file, {
    owner: String(uploaderUserId),
    visibility: "private",
    aclRules: [{ group: { type: ObjectAccessGroupType.USER_LIST, id: JSON.stringify(Array.from(readers)) }, permission: ObjectPermission.READ }],
  });
}

/** The file name is part of the message text ("📄 name"); the table has no title column. */
export type MessageAttachment = { type: string; url: string; mimeType: string | null; sizeBytes: number | null; durationSeconds: number | null };

export async function attachmentsByMessage(messageIds: number[]): Promise<Map<number, MessageAttachment[]>> {
  const out = new Map<number, MessageAttachment[]>();
  if (messageIds.length === 0) return out;
  const rows = await db.select().from(messagingAttachments).where(inArray(messagingAttachments.messageId, messageIds));
  for (const row of rows) {
    const list = out.get(row.messageId) ?? [];
    list.push({ type: row.attachmentType, url: row.url, mimeType: row.mimeType, sizeBytes: row.sizeBytes, durationSeconds: row.durationSeconds });
    out.set(row.messageId, list);
  }
  return out;
}


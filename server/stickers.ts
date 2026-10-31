/**
 * Stickers: each person keeps up to 100 sticker images ("My stickers").
 * Make one from your own photo, or save one somebody sent you (the server
 * copies the file so you own your copy). Sent as messageType "sticker".
 */
import { Router, type Request, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { userStickers } from "@shared/schema";
import { requireAuth } from "./role-middleware";
import { ObjectStorageService, ObjectNotFoundError } from "./ai_integrations/object_storage/objectStorage";
import { getObjectAclPolicy, setObjectAclPolicy } from "./ai_integrations/object_storage/objectAcl";
import { visibleMessage } from "./chat-extras";

const router = Router();
const MAX_STICKERS = 100;
const MAX_BYTES = 1024 * 1024;
const STICKER_MIME = /^image\/(png|webp|jpeg|gif)$/;

export async function ensureStickersTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_stickers" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "object_path" text NOT NULL,
      "created_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "user_stickers_unique" ON "user_stickers" ("user_id", "object_path")`);
}

async function count(userId: number) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(userStickers).where(eq(userStickers.userId, userId));
  return row?.n ?? 0;
}

router.get("/api/stickers", requireAuth, async (req: Request, res: Response) => {
  const rows = await db.select().from(userStickers).where(eq(userStickers.userId, req.user!.id)).orderBy(desc(userStickers.createdAt));
  res.json({ success: true, stickers: rows.map((r) => ({ id: r.id, objectPath: r.objectPath })) });
});

/** Make a sticker from a picture I just uploaded. */
router.post("/api/stickers", requireAuth, async (req: Request, res: Response) => {
  const parsed = z.object({ objectPath: z.string().startsWith("/objects/").max(500) }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Upload a picture first." });
  const userId = req.user!.id;
  if ((await count(userId)) >= MAX_STICKERS) return res.status(400).json({ error: `You can keep up to ${MAX_STICKERS} stickers. Delete some first.` });
  try {
    const file = await new ObjectStorageService().getObjectEntityFile(parsed.data.objectPath);
    const existing = await getObjectAclPolicy(file);
    const { mayClaimUpload } = await import("./ai_integrations/object_storage/upload-owner");
    if ((existing && existing.owner !== String(userId)) || (!existing && !(await mayClaimUpload(parsed.data.objectPath, userId)))) {
      return res.status(403).json({ error: "This picture belongs to someone else." });
    }
    const [info] = await file.getMetadata();
    if (!STICKER_MIME.test(info.contentType ?? "")) return res.status(400).json({ error: "Stickers must be PNG, WebP, JPEG or GIF pictures." });
    if ((info.size ?? 0) > MAX_BYTES) return res.status(400).json({ error: "Stickers must be under 1 MB." });
    if (!existing) await setObjectAclPolicy(file, { owner: String(userId), visibility: "private" });
    const [row] = await db.insert(userStickers).values({ userId, objectPath: parsed.data.objectPath }).onConflictDoNothing().returning();
    res.status(201).json({ success: true, sticker: row ? { id: row.id, objectPath: row.objectPath } : null });
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return res.status(400).json({ error: "The picture was not uploaded. Try again." });
    throw err;
  }
});

/** Save a sticker someone sent me in a chat. */
router.post("/api/stickers/save", requireAuth, async (req: Request, res: Response) => {
  const parsed = z.object({
    chatType: z.enum(["personal", "group"]),
    chatId: z.number().int().positive(),
    messageId: z.number().int().positive(),
  }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid sticker." });
  const userId = req.user!.id;
  const found = await visibleMessage(userId, parsed.data.chatType, parsed.data.chatId, parsed.data.messageId);
  const meta = (found?.message.metadata ?? {}) as Record<string, unknown>;
  if (!found || found.message.messageType !== "sticker" || typeof meta.attachmentUrl !== "string") {
    return res.status(404).json({ error: "Sticker not found." });
  }
  if ((await count(userId)) >= MAX_STICKERS) return res.status(400).json({ error: `You can keep up to ${MAX_STICKERS} stickers. Delete some first.` });
  try {
    const source = await new ObjectStorageService().getObjectEntityFile(meta.attachmentUrl);
    const copy = await source.copyToNewKey();
    await setObjectAclPolicy(copy, { owner: String(userId), visibility: "private" });
    const objectPath = `/objects/${copy.key}`;
    const [row] = await db.insert(userStickers).values({ userId, objectPath }).returning();
    res.status(201).json({ success: true, sticker: { id: row.id, objectPath } });
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return res.status(410).json({ error: "This sticker is no longer available." });
    throw err;
  }
});

router.delete("/api/stickers/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid sticker." });
  await db.delete(userStickers).where(and(eq(userStickers.id, id), eq(userStickers.userId, req.user!.id)));
  res.json({ success: true });
});

export default router;

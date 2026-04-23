/**
 * Contacts API — Server-synced address book for users
 * Replaces localStorage-only contacts with real DB persistence
 */

import { Router, Request, Response } from "express";
import { db } from "./db";
import { userContacts } from "@shared/schema";
import { eq, and, ilike, desc } from "drizzle-orm";

export function registerContactRoutes(app: Router) {
  // GET /api/contacts — List all contacts for the logged-in user
  app.get("/api/contacts", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const contacts = await db.select().from(userContacts)
        .where(eq(userContacts.userId, userId))
        .orderBy(desc(userContacts.isFavorite), desc(userContacts.lastCalledAt));

      res.json({ contacts });
    } catch (error) {
      console.error("[Contacts] List error:", error);
      res.status(500).json({ error: "Failed to load contacts" });
    }
  });

  // POST /api/contacts — Add a contact
  app.post("/api/contacts", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { name, identifier, language, notes } = req.body;
      if (!name || !identifier) {
        return res.status(400).json({ error: "Name and identifier are required" });
      }

      const [contact] = await db.insert(userContacts).values({
        userId,
        name: String(name).slice(0, 100),
        identifier: String(identifier).slice(0, 200),
        language: language || "en",
        notes: notes ? String(notes).slice(0, 500) : null,
      }).returning();

      res.status(201).json({ contact });
    } catch (error) {
      console.error("[Contacts] Create error:", error);
      res.status(500).json({ error: "Failed to create contact" });
    }
  });

  // PATCH /api/contacts/:id — Update a contact
  app.patch("/api/contacts/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const contactId = parseInt(req.params.id);

      const { name, identifier, language, isFavorite, notes, avatarUrl } = req.body;
      const updates: Record<string, any> = { updatedAt: new Date() };
      if (name !== undefined) updates.name = String(name).slice(0, 100);
      if (identifier !== undefined) updates.identifier = String(identifier).slice(0, 200);
      if (language !== undefined) updates.language = language;
      if (isFavorite !== undefined) updates.isFavorite = Boolean(isFavorite);
      if (notes !== undefined) updates.notes = notes ? String(notes).slice(0, 500) : null;
      if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;

      const [updated] = await db.update(userContacts)
        .set(updates)
        .where(and(eq(userContacts.id, contactId), eq(userContacts.userId, userId)))
        .returning();

      if (!updated) return res.status(404).json({ error: "Contact not found" });
      res.json({ contact: updated });
    } catch (error) {
      console.error("[Contacts] Update error:", error);
      res.status(500).json({ error: "Failed to update contact" });
    }
  });

  // DELETE /api/contacts/:id — Delete a contact
  app.delete("/api/contacts/:id", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const contactId = parseInt(req.params.id);

      const [deleted] = await db.delete(userContacts)
        .where(and(eq(userContacts.id, contactId), eq(userContacts.userId, userId)))
        .returning();

      if (!deleted) return res.status(404).json({ error: "Contact not found" });
      res.json({ message: "Contact deleted" });
    } catch (error) {
      console.error("[Contacts] Delete error:", error);
      res.status(500).json({ error: "Failed to delete contact" });
    }
  });

  // POST /api/contacts/:id/favorite — Toggle favorite
  app.post("/api/contacts/:id/favorite", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const contactId = parseInt(req.params.id);

      // Get current state
      const [existing] = await db.select().from(userContacts)
        .where(and(eq(userContacts.id, contactId), eq(userContacts.userId, userId)));
      if (!existing) return res.status(404).json({ error: "Contact not found" });

      const [updated] = await db.update(userContacts)
        .set({ isFavorite: !existing.isFavorite, updatedAt: new Date() })
        .where(eq(userContacts.id, contactId))
        .returning();

      res.json({ contact: updated });
    } catch (error) {
      console.error("[Contacts] Favorite error:", error);
      res.status(500).json({ error: "Failed to toggle favorite" });
    }
  });

  // POST /api/contacts/:id/called — Record that a call was made
  app.post("/api/contacts/:id/called", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const contactId = parseInt(req.params.id);

      const [updated] = await db.update(userContacts)
        .set({ lastCalledAt: new Date(), updatedAt: new Date() })
        .where(and(eq(userContacts.id, contactId), eq(userContacts.userId, userId)))
        .returning();

      if (!updated) return res.status(404).json({ error: "Contact not found" });
      res.json({ contact: updated });
    } catch (error) {
      console.error("[Contacts] Record call error:", error);
      res.status(500).json({ error: "Failed to record call" });
    }
  });

  console.log("[Routes] ✔ Contact routes");
}

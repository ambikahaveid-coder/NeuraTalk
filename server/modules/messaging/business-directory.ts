/**
 * NeuraTalk's own business directory and chat settings (WhatsApp-Business
 * style, entirely inside NeuraTalk):
 *  - customers find a business by name, by its link /b/<slug>, or its QR code
 *  - a consumer-safe public profile (no internal email/phone/legal data)
 *  - per-business chat settings: listed in search, greeting, away message
 *    with opening hours, quick replies
 * Settings live in organizations.settings[BUSINESS_MESSAGING_SETTINGS_KEY].
 */
import { z } from "zod";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { organizations } from "@shared/schema";

export const BUSINESS_MESSAGING_SETTINGS_KEY = "businessMessaging";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
export const businessMessagingSettingsSchema = z.object({
  listed: z.boolean().default(true),
  greeting: z.object({ enabled: z.boolean().default(false), text: z.string().trim().max(1000).default("") }).default({}),
  away: z.object({
    enabled: z.boolean().default(false),
    text: z.string().trim().max(1000).default(""),
    /** Opening hours per weekday (0 = Sunday); a missing day = closed all day. */
    hours: z.record(z.string().regex(/^[0-6]$/), z.object({ open: timeSchema, close: timeSchema })).default({}),
    timezone: z.string().max(64).default("Asia/Kolkata"),
  }).default({}),
  quickReplies: z.array(z.object({ shortcut: z.string().trim().min(1).max(30), text: z.string().trim().min(1).max(2000) })).max(50).default([]),
});
export type BusinessMessagingSettings = z.infer<typeof businessMessagingSettingsSchema>;

export function readMessagingSettings(settings: unknown): BusinessMessagingSettings {
  const raw = (settings as Record<string, unknown> | null)?.[BUSINESS_MESSAGING_SETTINGS_KEY];
  const parsed = businessMessagingSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : businessMessagingSettingsSchema.parse({});
}

export async function getMessagingSettings(businessId: number): Promise<BusinessMessagingSettings | null> {
  const [org] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, businessId));
  return org ? readMessagingSettings(org.settings) : null;
}

export async function updateMessagingSettings(businessId: number, input: unknown): Promise<BusinessMessagingSettings> {
  const next = businessMessagingSettingsSchema.parse(input);
  const [org] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, businessId));
  if (!org) throw new Error("Business not found");
  const settings = { ...((org.settings as Record<string, unknown>) ?? {}), [BUSINESS_MESSAGING_SETTINGS_KEY]: next };
  await db.update(organizations).set({ settings }).where(eq(organizations.id, businessId));
  return next;
}

/** Is the business inside its opening hours right now? (no hours set = always open) */
export function isWithinOpeningHours(settings: BusinessMessagingSettings, now = new Date()): boolean {
  const hours = settings.away.hours;
  if (Object.keys(hours).length === 0) return true;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.away.timezone || "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
  const hhmm = `${parts.find((p) => p.type === "hour")?.value ?? "00"}:${parts.find((p) => p.type === "minute")?.value ?? "00"}`.replace(/^24/, "00");
  const today = hours[String(weekday)];
  if (!today) return false;
  return today.open <= today.close ? hhmm >= today.open && hhmm < today.close : hhmm >= today.open || hhmm < today.close;
}

export interface PublicBusinessProfile {
  id: number;
  name: string;
  slug: string;
  logoUrl: string | null;
  description: string | null;
  category: string | null;
  city: string | null;
  /** Street address + city, for the business info page. */
  address: string | null;
  website: string | null;
  /** Blue tick: a NeuraTalk admin checked this business (not just signed up). */
  verified: boolean;
  openNow: boolean;
  hours: BusinessMessagingSettings["away"]["hours"];
}

const publicColumns = {
  id: organizations.id,
  name: organizations.name,
  slug: organizations.slug,
  logoUrl: organizations.logoUrl,
  description: organizations.description,
  industry: organizations.industry,
  addressCity: organizations.addressCity,
  addressState: organizations.addressState,
  address: organizations.address,
  website: organizations.website,
  verifiedAt: organizations.verifiedAt,
  status: organizations.status,
  isActive: organizations.isActive,
  settings: organizations.settings,
};

type PublicRow = { [K in keyof typeof publicColumns]: unknown } & {
  id: number; name: string; slug: string; logoUrl: string | null; description: string | null; industry: string | null;
  addressCity: string | null; addressState: string | null; address: string | null; website: string | null;
  verifiedAt: Date | null; status: string | null; isActive: boolean | null;
};

function toPublic(row: PublicRow): PublicBusinessProfile {
  const settings = readMessagingSettings(row.settings);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logoUrl,
    description: row.description,
    category: row.industry,
    city: [row.addressCity, row.addressState].filter(Boolean).join(", ") || null,
    address: [row.address, row.addressCity, row.addressState].filter(Boolean).join(", ") || null,
    website: row.website,
    verified: Boolean(row.verifiedAt) && row.status === "approved",
    openNow: isWithinOpeningHours(settings),
    hours: settings.away.hours,
  };
}

const operational = () => and(eq(organizations.status, "approved"), eq(organizations.isActive, true));

/** Customer search: approved, active, listed businesses. */
export async function searchBusinesses(query: string, limit = 20): Promise<PublicBusinessProfile[]> {
  const q = query.trim();
  const rows = await db.select(publicColumns).from(organizations)
    .where(and(
      operational(),
      sql`coalesce((${organizations.settings} -> ${BUSINESS_MESSAGING_SETTINGS_KEY} ->> 'listed')::boolean, true)`,
      q ? or(ilike(organizations.name, `%${q}%`), ilike(organizations.industry, `%${q}%`), ilike(organizations.addressCity, `%${q}%`)) : undefined,
    ))
    .orderBy(asc(organizations.name))
    .limit(Math.min(Math.max(limit, 1), 50));
  return (rows as PublicRow[]).map(toPublic);
}

/** Profile for the chat header / link page. Unlisted businesses are still reachable by id or link. */
export async function getPublicBusinessProfile(idOrSlug: number | string): Promise<PublicBusinessProfile | null> {
  const where = typeof idOrSlug === "number" ? eq(organizations.id, idOrSlug) : eq(organizations.slug, idOrSlug);
  const [row] = await db.select(publicColumns).from(organizations).where(and(where, operational()));
  return row ? toPublic(row as PublicRow) : null;
}

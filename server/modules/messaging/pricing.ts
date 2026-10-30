/**
 * Business message prices, set by the NeuraTalk super admin (one row,
 * `business_message_prices`, created at startup). Charged per delivered
 * message: marketing and utility campaigns, utility events and OTP codes.
 * Defaults are the earlier fixed values (10 / 10 / 15 paise).
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";

export interface MessagePrices {
  marketingPaise: number;
  utilityPaise: number;
  otpPaise: number;
  updatedAt: string | null;
}

export const DEFAULT_PRICES: MessagePrices = { marketingPaise: 10, utilityPaise: 10, otpPaise: 15, updatedAt: null };
const CACHE_MS = 60_000;
let cache: { at: number; value: MessagePrices } | null = null;

export async function ensurePricesTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "business_message_prices" (
      "id" integer PRIMARY KEY DEFAULT 1,
      "marketing_paise" integer NOT NULL DEFAULT 10,
      "utility_paise" integer NOT NULL DEFAULT 10,
      "otp_paise" integer NOT NULL DEFAULT 15,
      "updated_by" integer,
      "updated_at" timestamp DEFAULT now(),
      CONSTRAINT "business_message_prices_single_row" CHECK ("id" = 1)
    )`);
}

function rows(result: unknown): Record<string, unknown>[] {
  return ((result as { rows?: Record<string, unknown>[] }).rows ?? (result as Record<string, unknown>[])) || [];
}

export async function getMessagePrices(): Promise<MessagePrices> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const [row] = rows(await db.execute(sql`SELECT marketing_paise, utility_paise, otp_paise, updated_at FROM business_message_prices WHERE id = 1`));
    const value: MessagePrices = row
      ? {
          marketingPaise: Number(row.marketing_paise),
          utilityPaise: Number(row.utility_paise),
          otpPaise: Number(row.otp_paise),
          updatedAt: row.updated_at ? new Date(row.updated_at as string).toISOString() : null,
        }
      : DEFAULT_PRICES;
    cache = { at: Date.now(), value };
    return value;
  } catch {
    // Table missing (startup not run yet) or a database blip: last known or defaults.
    return cache?.value ?? DEFAULT_PRICES;
  }
}

export async function setMessagePrices(input: { marketingPaise: number; utilityPaise: number; otpPaise: number }, adminUserId: number): Promise<MessagePrices> {
  await ensurePricesTable();
  await db.execute(sql`
    INSERT INTO business_message_prices (id, marketing_paise, utility_paise, otp_paise, updated_by, updated_at)
    VALUES (1, ${input.marketingPaise}, ${input.utilityPaise}, ${input.otpPaise}, ${adminUserId}, now())
    ON CONFLICT (id) DO UPDATE SET
      marketing_paise = EXCLUDED.marketing_paise,
      utility_paise = EXCLUDED.utility_paise,
      otp_paise = EXCLUDED.otp_paise,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()`);
  cache = null;
  return getMessagePrices();
}

/** Price of one campaign message in its category. */
export async function campaignPricePaise(category: string): Promise<number> {
  const p = await getMessagePrices();
  return category === "marketing" ? p.marketingPaise : p.utilityPaise;
}

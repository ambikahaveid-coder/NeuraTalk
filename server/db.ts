import "./load-env";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { logger } from "./observability";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * PRODUCTION-GRADE POOL CONFIGURATION
 * Max: 20 concurrent connections to ensure scalability
 * Idle Timeout: 30s to release unused resources
 * Max Lifetime: 1hr to prevent stale connections
 * Connect Timeout: 5s to fail fast on unreachable databases
 */
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000, // Neon cold-start can take 5-10s
});

pool.on("error", (error) => {
  logger.error("Database", "Database pool emitted an error", error instanceof Error ? error : new Error(String(error)));
});

export async function assertDatabaseReady(timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  const client = await Promise.race([
    pool.connect(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Database connection timed out")), timeoutMs);
    }),
  ]);

  try {
    await client.query("SELECT 1");
    logger.info("Database", `Database readiness check passed in ${Date.now() - start}ms.`);
  } finally {
    client.release();
  }
}

// Graceful pool shutdown on process exit
export const shutdownPool = async () => {
  logger.warn("Database", "Closing database pool due to process exit...");
  await pool.end();
};

process.on("SIGTERM", shutdownPool);
process.on("SIGINT", shutdownPool);

export const db = drizzle(pool, { schema });

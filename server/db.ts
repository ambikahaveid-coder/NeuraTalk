import "./load-env";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { logger } from "./observability";

const { Pool } = pg;

type AppDb = NodePgDatabase<typeof schema> & {
  $client: pg.Pool;
};

let poolInstance: pg.Pool | null = null;
let dbInstance: AppDb | null = null;

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }

  return databaseUrl;
}

function shouldUseSsl(databaseUrl: string): boolean {
  try {
    const url = new URL(databaseUrl);
    return !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function getPool(): pg.Pool {
  if (poolInstance) {
    return poolInstance;
  }

  const databaseUrl = requireDatabaseUrl();
  poolInstance = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 10000,       // release idle conns before Neon auto-suspends
    connectionTimeoutMillis: 15000, // Neon cold-start can take 5-10s
    keepAlive: true,                // TCP keepalive so dropped Neon conns fail fast
    keepAliveInitialDelayMillis: 10000,
    ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined,
  });

  poolInstance.on("error", (error) => {
    logger.error("Database", "Database pool emitted an error", error instanceof Error ? error : new Error(String(error)));
  });

  // Prevent stale Neon connections from hanging queries indefinitely (causes 504s)
  poolInstance.on("connect", (client) => {
    void client.query("SET statement_timeout = 20000"); // 20s max per query
  });

  return poolInstance;
}

function getDb(): AppDb {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = drizzle<typeof schema, pg.Pool>(getPool(), { schema });
  return dbInstance;
}

/**
 * PRODUCTION-GRADE POOL CONFIGURATION
 * Max: 20 concurrent connections to ensure scalability
 * Idle Timeout: 30s to release unused resources
 * Max Lifetime: 1hr to prevent stale connections
 * Connect Timeout: 5s to fail fast on unreachable databases
 */
export const pool = new Proxy({} as pg.Pool, {
  get(_target, property, receiver) {
    return Reflect.get(getPool() as unknown as object, property, receiver);
  },
});

export async function assertDatabaseReady(timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  const client = await Promise.race([
    getPool().connect(),
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
  if (!poolInstance) {
    return;
  }

  logger.warn("Database", "Closing database pool due to process exit...");
  await poolInstance.end();
  poolInstance = null;
  dbInstance = null;
};

process.on("SIGTERM", shutdownPool);
process.on("SIGINT", shutdownPool);

export const db = new Proxy({} as AppDb, {
  get(_target, property, receiver) {
    return Reflect.get(getDb() as unknown as object, property, receiver);
  },
});

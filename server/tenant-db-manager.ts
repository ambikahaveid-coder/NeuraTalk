import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { tenantDatabases, tenantSecurityPolicies } from "@shared/schema";
import { db, pool as rootPool } from "./db";
import { logger, toHumanReadableError } from "./observability";

type DrizzleDb = typeof db;

interface DedicatedRuntime {
  connectionString: string;
  pool: pg.Pool;
  db: DrizzleDb;
}

const dedicatedRuntimeCache = new Map<number, DedicatedRuntime>();

async function ensureTenantDatabaseRecord(organizationId: number) {
  const existing = (await db.select().from(tenantDatabases)
    .where(eq(tenantDatabases.organizationId, organizationId))
    .limit(1))[0];

  if (existing) {
    return existing;
  }

  const [created] = await db.insert(tenantDatabases).values({
    organizationId,
    mode: "shared",
    status: "active",
    region: "ap-south-1",
    poolMax: 10,
    enforceIsolationGuards: true,
  }).returning();

  return created;
}

async function ensureTenantSecurityPolicyRecord(organizationId: number) {
  const existing = (await db.select().from(tenantSecurityPolicies)
    .where(eq(tenantSecurityPolicies.organizationId, organizationId))
    .limit(1))[0];

  if (existing) {
    return existing;
  }

  const [created] = await db.insert(tenantSecurityPolicies).values({
    organizationId,
    requireTenantHeader: true,
    enforceSessionTenantBinding: true,
    allowMultipleSessions: true,
    sessionTimeoutMinutes: 1440,
    requireMfaForAdmins: false,
  }).returning();

  return created;
}

function getOrCreateDedicatedRuntime(config: typeof tenantDatabases.$inferSelect): DedicatedRuntime {
  const cached = dedicatedRuntimeCache.get(config.organizationId);
  if (cached && cached.connectionString === config.databaseUrl) {
    return cached;
  }

  if (!config.databaseUrl) {
    throw new Error("Dedicated tenant database is missing databaseUrl");
  }

  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: Math.min(Math.max(config.poolMax || 10, 1), 50),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  const tenantDb = drizzle(pool, { schema }) as DrizzleDb;
  const runtime: DedicatedRuntime = {
    connectionString: config.databaseUrl,
    pool,
    db: tenantDb,
  };

  dedicatedRuntimeCache.set(config.organizationId, runtime);
  return runtime;
}

export async function getTenantIsolationState(organizationId: number) {
  const [databaseConfig, securityPolicy] = await Promise.all([
    ensureTenantDatabaseRecord(organizationId),
    ensureTenantSecurityPolicyRecord(organizationId),
  ]);

  return {
    databaseConfig,
    securityPolicy,
  };
}

export async function getTenantDb(organizationId: number): Promise<{
  db: DrizzleDb;
  rootDb: DrizzleDb;
  mode: "shared" | "dedicated";
  databaseConfig: typeof tenantDatabases.$inferSelect;
  securityPolicy: typeof tenantSecurityPolicies.$inferSelect;
}> {
  const { databaseConfig, securityPolicy } = await getTenantIsolationState(organizationId);

  if (databaseConfig.mode === "dedicated" && databaseConfig.databaseUrl) {
    const runtime = getOrCreateDedicatedRuntime(databaseConfig);
    return {
      db: runtime.db,
      rootDb: db,
      mode: "dedicated",
      databaseConfig,
      securityPolicy,
    };
  }

  return {
    db,
    rootDb: db,
    mode: "shared",
    databaseConfig,
    securityPolicy,
  };
}

export async function runTenantDatabaseHealthCheck(organizationId: number) {
  const { mode, databaseConfig } = await getTenantDb(organizationId);
  const checkedAt = new Date();

  try {
    if (mode === "dedicated" && databaseConfig.databaseUrl) {
      const runtime = getOrCreateDedicatedRuntime(databaseConfig);
      await runtime.pool.query("select 1");
    } else {
      await rootPool.query("select 1");
    }

    const [updated] = await db.update(tenantDatabases)
      .set({
        lastHealthStatus: "healthy",
        lastHealthCheckedAt: checkedAt,
        updatedAt: checkedAt,
      })
      .where(eq(tenantDatabases.organizationId, organizationId))
      .returning();

    return {
      success: true,
      mode,
      checkedAt,
      config: updated || databaseConfig,
    };
  } catch (error) {
    logger.error("TenantDB", "Tenant database health check failed", error as Error, {
      organizationId,
      mode,
    });

    const [updated] = await db.update(tenantDatabases)
      .set({
        lastHealthStatus: "unhealthy",
        lastHealthCheckedAt: checkedAt,
        updatedAt: checkedAt,
        metadata: {
          ...((databaseConfig.metadata as Record<string, unknown> | null) || {}),
          lastError: toHumanReadableError(error instanceof Error ? error.message : String(error)),
          lastHealthFailureAt: checkedAt.toISOString(),
        },
      })
      .where(eq(tenantDatabases.organizationId, organizationId))
      .returning();

    return {
      success: false,
      mode,
      checkedAt,
      config: updated || databaseConfig,
      error: toHumanReadableError(error instanceof Error ? error.message : String(error)),
    };
  }
}

export async function closeTenantDatabasePools(): Promise<void> {
  const runtimes = Array.from(dedicatedRuntimeCache.values());
  dedicatedRuntimeCache.clear();

  await Promise.allSettled(runtimes.map(async (runtime) => {
    try {
      await runtime.pool.end();
    } catch (error) {
      logger.warn("TenantDB", "Failed to close dedicated tenant pool", {
        error: toHumanReadableError(error instanceof Error ? error.message : String(error)),
      });
    }
  }));
}

process.on("SIGTERM", () => {
  void closeTenantDatabasePools();
});

process.on("SIGINT", () => {
  void closeTenantDatabasePools();
});

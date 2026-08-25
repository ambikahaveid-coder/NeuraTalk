import Redis from "ioredis";
import "./load-env";
import { logger } from "./observability";

type RedisConstructor = new (...args: any[]) => Redis;
type RedisBackendMode = "uninitialized" | "remote" | "in_memory";

interface RedisRuntimeStatus {
  mode: RedisBackendMode;
  ready: boolean;
  degraded: boolean;
  lastError: string | null;
}

let redisClient: Redis | null = null;
let lifecycleBound = false;
let shutdownBound = false;
let redisMockCtor: RedisConstructor | null = null;
let redisRuntimeStatus: RedisRuntimeStatus = {
  mode: "uninitialized",
  ready: false,
  degraded: false,
  lastError: null,
};

function setRedisRuntimeStatus(next: Partial<RedisRuntimeStatus>): void {
  redisRuntimeStatus = {
    ...redisRuntimeStatus,
    ...next,
  };
}

/**
 * Parse a Redis Sentinel URL into ioredis Sentinel config.
 * Format: redis-sentinel://password@host1:port1,host2:port2/master_name
 * OR:     sentinel://host1:port1,host2:port2?name=master&password=pass
 */
function parseSentinelUrl(url: string): { sentinels: Array<{ host: string; port: number }>; name: string; password?: string } | null {
  try {
    const sentinelPrefixes = ["redis-sentinel://", "sentinel://", "rediss-sentinel://"];
    const matched = sentinelPrefixes.find((p) => url.toLowerCase().startsWith(p));
    if (!matched) return null;

    const stripped = url.slice(matched.length);
    // Extract password if present: password@hosts/name
    let password: string | undefined;
    let remainder = stripped;
    if (remainder.includes("@")) {
      const atIdx = remainder.indexOf("@");
      password = decodeURIComponent(remainder.slice(0, atIdx));
      remainder = remainder.slice(atIdx + 1);
    }
    // Extract master name from path
    let masterName = "mymaster";
    if (remainder.includes("/")) {
      const slashIdx = remainder.lastIndexOf("/");
      masterName = remainder.slice(slashIdx + 1).split("?")[0] || "mymaster";
      remainder = remainder.slice(0, slashIdx);
    }
    // Parse query for name override
    if (url.includes("?name=")) {
      const match = url.match(/[?&]name=([^&]+)/);
      if (match) masterName = decodeURIComponent(match[1]);
    }
    // Parse sentinel hosts
    const hosts = remainder.split(",").map((h) => {
      const parts = h.trim().split(":");
      return { host: parts[0] || "127.0.0.1", port: parseInt(parts[1] || "26379", 10) };
    });

    return { sentinels: hosts, name: masterName, password };
  } catch {
    return null;
  }
}

function createRemoteRedisClient(url: string): Redis {
  // Sentinel mode
  const sentinelConfig = parseSentinelUrl(url);
  if (sentinelConfig) {
    logger.info("Redis", `Connecting via Redis Sentinel: master=${sentinelConfig.name}, nodes=${sentinelConfig.sentinels.length}`);
    const client = new Redis({
      sentinels: sentinelConfig.sentinels,
      name: sentinelConfig.name,
      password: sentinelConfig.password,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      enableReadyCheck: false,
      connectTimeout: 5_000,
      retryStrategy: (attempt: number) => {
        if (attempt >= 8) return null;
        return Math.min(attempt * 500, 5_000);
      },
      reconnectOnError: () => true,
      sentinelRetryStrategy: (attempt: number) => Math.min(attempt * 200, 2_000),
    } as any);
    bindLifecycle(client);
    return client;
  }

  // Standard single-node mode
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    enableReadyCheck: false,
    connectTimeout: 5_000,
    retryStrategy: (attempt: number) => {
      if (attempt >= 8) {
        return null;
      }
      return Math.min(attempt * 500, 5_000);
    },
    reconnectOnError: () => true,
  });
  bindLifecycle(client);
  return client;
}

async function resetRedisClient(client: Redis | null): Promise<void> {
  if (!client) {
    redisClient = null;
    lifecycleBound = false;
    setRedisRuntimeStatus({ ready: false });
    return;
  }

  try {
    client.disconnect();
  } catch {
    // ignore cleanup failures during connection reset
  } finally {
    if (redisClient === client) {
      redisClient = null;
    }
    lifecycleBound = false;
    setRedisRuntimeStatus({ ready: false });
  }
}

function isInMemoryUrl(url: string): boolean {
  return url.startsWith("memory://") || url === "mock" || url === "inmemory";
}

function allowRedisFallback(): boolean {
  const mode = (process.env.NODE_ENV || "").toLowerCase();
  const explicit = (process.env.ALLOW_DEGRADED_STARTUP || "").toLowerCase();
  return explicit === "true" || mode !== "production";
}

function shouldPreferInMemoryRedis(): boolean {
  if (!allowRedisFallback()) {
    return false;
  }

  const explicitRemote = (process.env.USE_REMOTE_REDIS || "").toLowerCase();
  if (explicitRemote === "true") {
    return false;
  }

  const rawUrl = (process.env.REDIS_URL || "").trim();
  if (!rawUrl) {
    return true;
  }

  if (isInMemoryUrl(rawUrl)) {
    return true;
  }

  try {
    const parsed = new URL(rawUrl);
    const host = (parsed.hostname || "").toLowerCase();
    // Use in-memory shim only when URL points to localhost (local dev only)
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

if (shouldPreferInMemoryRedis()) {
  process.env.REDIS_URL = "memory://local-dev";
}

async function getRedisMockCtor(): Promise<RedisConstructor> {
  if (redisMockCtor) {
    return redisMockCtor;
  }

  const mod = await import("ioredis-mock");
  redisMockCtor = (mod.default ?? mod) as unknown as RedisConstructor;
  return redisMockCtor;
}

async function createInMemoryRedis(): Promise<Redis> {
  const RedisMock = await getRedisMockCtor();
  const client = new RedisMock() as Redis;
  logger.warn("Redis", "Using in-memory Redis shim (ioredis-mock) — DO NOT use in production");
  return client;
}

function bindLifecycle(client: Redis) {
  if (lifecycleBound) {
    return;
  }

  lifecycleBound = true;
  client.on("error", (error) => {
    logger.error("Redis", "Redis client error", error instanceof Error ? error : new Error(String(error)));
  });
  client.on("connect", () => {
    setRedisRuntimeStatus({ ready: false, lastError: null });
    logger.info("Redis", "Redis client connected");
  });
  client.on("ready", () => {
    setRedisRuntimeStatus({
      mode: "remote",
      ready: true,
      degraded: false,
      lastError: null,
    });
    logger.info("Redis", "Redis client ready");
  });
  client.on("close", () => {
    setRedisRuntimeStatus({ ready: false });
    logger.warn("Redis", "Redis connection closed");
  });
  client.on("reconnecting", (delay: number) => {
    logger.warn("Redis", `Redis reconnecting in ${delay}ms`);
  });
  client.on("end", () => {
    setRedisRuntimeStatus({ ready: false });
    logger.warn("Redis", "Redis connection ended");
  });
}

export function getRedisRuntimeStatus(): RedisRuntimeStatus {
  return { ...redisRuntimeStatus };
}

export function isRedisReady(): boolean {
  return redisRuntimeStatus.ready;
}

export function isRedisDegraded(): boolean {
  return redisRuntimeStatus.degraded;
}

export function getRedisClient(): Redis {
  if (shouldPreferInMemoryRedis()) {
    if (!redisClient) {
      throw new Error("In-memory Redis must be initialized via assertRedisReady() first");
    }

    return redisClient;
  }

  if (!process.env.REDIS_URL) {
    if (allowRedisFallback()) {
      throw new Error("REDIS_URL must be initialized via assertRedisReady() first");
    }
    throw new Error("REDIS_URL must be set");
  }

  if (!redisClient) {
    if (isInMemoryUrl(process.env.REDIS_URL)) {
      throw new Error("In-memory Redis must be initialized via assertRedisReady() first");
    }
    redisClient = createRemoteRedisClient(process.env.REDIS_URL);
  }

  return redisClient;
}

let redisSubscriberClient: Redis | null = null;

/**
 * P2: a dedicated, duplicated connection for Redis SUBSCRIBE mode --
 * required because a client in subscribe mode can't issue normal commands
 * (including PUBLISH) on the same connection. Reuses whatever mode
 * (remote or in-memory mock) the main client is already running in via
 * `.duplicate()`, which carries over the same connection options
 * (retryStrategy, reconnectOnError, etc.) -- no separate reconnect logic
 * to maintain here. Lazily created on first call, one per process (not
 * per caller) -- callers should not call `.duplicate()` themselves.
 * Throws the same "not ready yet" errors as getRedisClient() if called
 * before assertRedisReady() has run at startup; callers (see
 * server/modules/messaging/realtime.ts) are expected to catch and degrade
 * gracefully, never to crash the process on this.
 */
export function getRedisSubscriberClient(): Redis {
  if (!redisSubscriberClient) {
    const base = getRedisClient();
    redisSubscriberClient = base.duplicate();
    redisSubscriberClient.on("error", (error) => {
      logger.error("Redis", "Redis subscriber client error", error instanceof Error ? error : new Error(String(error)));
    });
  }
  return redisSubscriberClient;
}

export async function assertRedisReady(timeoutMs = 5_000): Promise<void> {
  const start = Date.now();

  if (shouldPreferInMemoryRedis()) {
    if (!redisClient) {
      redisClient = await createInMemoryRedis();
      lifecycleBound = false;
      bindLifecycle(redisClient);
    }
    await redisClient.ping();
    setRedisRuntimeStatus({
      mode: "in_memory",
      ready: true,
      degraded: true,
      lastError: null,
    });
    logger.warn("Redis", `Using in-memory Redis shim for local startup in ${Date.now() - start}ms`);
    return;
  }

  if (!process.env.REDIS_URL && allowRedisFallback()) {
    if (!redisClient) {
      redisClient = await createInMemoryRedis();
      lifecycleBound = false;
      bindLifecycle(redisClient);
    }
    await redisClient.ping();
    setRedisRuntimeStatus({
      mode: "in_memory",
      ready: true,
      degraded: true,
      lastError: null,
    });
    logger.warn("Redis", `REDIS_URL missing; using in-memory Redis shim in ${Date.now() - start}ms`);
    return;
  }

  if (process.env.REDIS_URL && isInMemoryUrl(process.env.REDIS_URL)) {
    if (!redisClient) {
      redisClient = await createInMemoryRedis();
      lifecycleBound = false;
      bindLifecycle(redisClient);
    }
    await redisClient.ping();
    setRedisRuntimeStatus({
      mode: "in_memory",
      ready: true,
      degraded: true,
      lastError: null,
    });
    logger.info("Redis", `In-memory Redis ready in ${Date.now() - start}ms`);
    return;
  }

  const client = getRedisClient();

  try {
    if (client.status !== "ready") {
      await Promise.race([
        client.connect(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Redis connection timed out")), timeoutMs);
        }),
      ]);
    }

    await Promise.race([
      client.ping(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Redis ping timed out")), timeoutMs);
      }),
    ]);

    logger.info("Redis", `Redis readiness check passed in ${Date.now() - start}ms`);
  } catch (error) {
    setRedisRuntimeStatus({
      mode: "remote",
      ready: false,
      degraded: false,
      lastError: error instanceof Error ? error.message : String(error),
    });

    if (!allowRedisFallback()) {
      await resetRedisClient(client);
      throw error;
    }

    logger.warn(
      "Redis",
      `Redis unavailable in local/degraded mode; falling back to in-memory shim: ${error instanceof Error ? error.message : String(error)}`,
    );

    await resetRedisClient(client);

    redisClient = await createInMemoryRedis();
    lifecycleBound = false;
    bindLifecycle(redisClient);
    await redisClient.ping();
    setRedisRuntimeStatus({
      mode: "in_memory",
      ready: true,
      degraded: true,
      lastError: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function closeRedisClient(): Promise<void> {
  if (!redisClient) {
    return;
  }

  try {
    await redisClient.quit();
  } catch {
    redisClient.disconnect();
  } finally {
    redisClient = null;
    lifecycleBound = false;
    setRedisRuntimeStatus({
      mode: "uninitialized",
      ready: false,
      degraded: false,
      lastError: null,
    });
  }
}

export async function withRedisLock<T>(
  key: string,
  handler: () => Promise<T>,
  options?: { ttlMs?: number; retries?: number; retryDelayMs?: number },
): Promise<T> {
  const client = getRedisClient();
  const ttlMs = options?.ttlMs ?? 5_000;
  const retries = options?.retries ?? 100;
  const retryDelayMs = options?.retryDelayMs ?? 50;
  const token = `${process.pid}:${Date.now()}:${Math.random()}`;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const acquired = await client.set(key, token, "PX", ttlMs, "NX");
    if (acquired === "OK") {
      try {
        return await handler();
      } finally {
        try {
          await client.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            1,
            key,
            token,
          );
        } catch (error) {
          logger.warn("Redis", `Failed to release lock ${key}: ${String(error)}`);
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  throw new Error(`Failed to acquire Redis lock for ${key}`);
}

if (!shutdownBound) {
  shutdownBound = true;

  const shutdown = async () => {
    await closeRedisClient();
  };

  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });
}

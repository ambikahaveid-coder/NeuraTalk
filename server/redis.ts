import Redis from "ioredis";
import "./load-env";
import { logger } from "./observability";

let redisClient: Redis | null = null;
let lifecycleBound = false;
let shutdownBound = false;

function isInMemoryUrl(url: string): boolean {
  return url.startsWith("memory://") || url === "mock" || url === "inmemory";
}

async function createInMemoryRedis(): Promise<Redis> {
  const mod = await import("ioredis-mock");
  const RedisMock = (mod as any).default || mod;
  const client = new RedisMock() as unknown as Redis;
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
    logger.info("Redis", "Redis client connected");
  });
  client.on("ready", () => {
    logger.info("Redis", "Redis client ready");
  });
  client.on("close", () => {
    logger.warn("Redis", "Redis connection closed");
  });
  client.on("reconnecting", (delay: number) => {
    logger.warn("Redis", `Redis reconnecting in ${delay}ms`);
  });
  client.on("end", () => {
    logger.warn("Redis", "Redis connection ended");
  });
}

export function getRedisClient(): Redis {
  if (!process.env.REDIS_URL) {
    throw new Error("REDIS_URL must be set");
  }

  if (!redisClient) {
    if (isInMemoryUrl(process.env.REDIS_URL)) {
      throw new Error("In-memory Redis must be initialized via assertRedisReady() first");
    }
    redisClient = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      enableReadyCheck: false,
      connectTimeout: 5_000,
    });
    bindLifecycle(redisClient);
  }

  return redisClient;
}

export async function assertRedisReady(timeoutMs = 5_000): Promise<void> {
  const start = Date.now();

  if (process.env.REDIS_URL && isInMemoryUrl(process.env.REDIS_URL)) {
    if (!redisClient) {
      redisClient = await createInMemoryRedis();
    }
    await redisClient.ping();
    logger.info("Redis", `In-memory Redis ready in ${Date.now() - start}ms`);
    return;
  }

  const client = getRedisClient();

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

import "./load-env";
import fs from "fs";
import path from "path";
import express, { type Request, Response, NextFunction } from "express";
// Express 4 does not forward a rejected promise from an async route handler
// to next(err) — it's silently dropped as an unhandledRejection, which this
// process treats as fatal (see bindProcessHandlers below) and shuts the
// whole server down for what should have been a single failed request.
// This patches Router/Layer dispatch so async handler rejections are always
// routed to the Express error-handling middleware instead. Must be imported
// before any route is registered (safe here: it patches shared express
// prototypes at import time, before the HTTP listener starts accepting
// requests further down this file).
import "express-async-errors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { corsMiddleware, httpsRedirect, securityHeaders } from "./security-middleware";
import { requestContextMiddleware } from "./request-context-middleware";
import { httpMetricsMiddleware } from "./http-metrics-middleware";
import { startReliabilityMonitor } from "./reliability-monitor";
import { logger } from "./observability";
import { validateEnvironment } from "./env-validator";
import { assertDatabaseReady, shutdownPool } from "./db";
import { assertRedisReady, closeRedisClient, getRedisRuntimeStatus } from "./redis";
import { BillingEngine } from "./billing-engine";
import { startCommunicationBillingLoop } from "./communication-api-service";
import { isLegacyTwilioBridgeEnabled } from "./call-platform-config";
import { configService } from "./config-service";
import { startSmartCallWatchdog } from "./modules/calls/smart-router";
import { runScheduledHealthCheck } from "./pstn/monitor";
import { initFreeSwitchESL } from "./media/freeswitch/esl-client";
import { initRTPAIWorker } from "./ai-pipeline/rtp-worker";

const app = express();
app.set("trust proxy", 1); // trust Cloudflare/DO proxy so req.ip is the real client IP
app.disable("x-powered-by"); // don't leak server framework info
const httpServer = createServer(app);
let processHandlersBound = false;
let shuttingDown = false;
const startupPhaseState = new Map<string, { startedAt: number; status: "running" | "completed" | "failed"; durationMs?: number; error?: string }>();
const STARTUP_PHASE_TIMEOUT_MS = Number.parseInt(process.env.STARTUP_PHASE_TIMEOUT_MS || "15000", 10);
const STARTUP_GLOBAL_TIMEOUT_MS = Number.parseInt(process.env.STARTUP_GLOBAL_TIMEOUT_MS || "60000", 10);
const STARTUP_TRACE_FILE = path.resolve(process.cwd(), ".tmp", "startup-phase-trace.log");
let startupTimeoutHandle: NodeJS.Timeout | null = null;

httpServer.on("error", (error) => {
  logger.error("Server", "HTTP server emitted an error", error instanceof Error ? error : new Error(String(error)));
  void shutdownServer(1);
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: false, limit: "50mb" }));
app.use(requestContextMiddleware);
app.use(httpMetricsMiddleware);
app.use(corsMiddleware);
app.use(httpsRedirect);
app.use(securityHeaders);

export function log(message: string, source = "Express") {
  logger.info(source, message);
}

function writeStartupTrace(message: string, metadata?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    pid: process.pid,
    message,
    metadata: metadata || {},
  });

  try {
    fs.mkdirSync(path.dirname(STARTUP_TRACE_FILE), { recursive: true });
    fs.appendFileSync(STARTUP_TRACE_FILE, `${line}\n`, "utf8");
  } catch {
    // Best-effort only. Do not break startup diagnostics if file writes fail.
  }
}

function isStartupSubsystemDisabled(name: string): boolean {
  return (process.env[`DISABLE_${name.toUpperCase()}_STARTUP`] || "").toLowerCase() === "true";
}

function summarizeHandle(handle: unknown): Record<string, unknown> {
  const candidate = handle as {
    constructor?: { name?: string };
    fd?: number;
    localAddress?: string;
    localPort?: number;
    remoteAddress?: string;
    remotePort?: number;
    hasRef?: () => boolean;
    _idleTimeout?: number;
    _onTimeout?: unknown;
  };

  return {
    type: candidate?.constructor?.name || typeof handle,
    fd: candidate?.fd,
    localAddress: candidate?.localAddress,
    localPort: candidate?.localPort,
    remoteAddress: candidate?.remoteAddress,
    remotePort: candidate?.remotePort,
    hasRef: typeof candidate?.hasRef === "function" ? candidate.hasRef() : undefined,
    idleTimeout: candidate?._idleTimeout,
    hasOnTimeout: typeof candidate?._onTimeout === "function",
  };
}

function dumpStartupDiagnostics(reason: string): void {
  const getActiveHandles = (process as NodeJS.Process & { _getActiveHandles?: () => unknown[] })._getActiveHandles;
  const getActiveRequests = (process as NodeJS.Process & { _getActiveRequests?: () => unknown[] })._getActiveRequests;
  const handles = typeof getActiveHandles === "function" ? getActiveHandles.call(process) : [];
  const requests = typeof getActiveRequests === "function" ? getActiveRequests.call(process) : [];

  logger.error("Startup", `Startup diagnostics dump: ${reason}`, new Error(reason), {
    phases: Array.from(startupPhaseState.entries()).map(([name, state]) => ({ name, ...state })),
    activeHandles: handles.map(summarizeHandle),
    activeRequests: requests.map(summarizeHandle),
  });
  writeStartupTrace(`diagnostics:${reason}`, {
    phases: Array.from(startupPhaseState.entries()).map(([name, state]) => ({ name, ...state })),
    activeHandles: handles.map(summarizeHandle),
    activeRequests: requests.map(summarizeHandle),
  });
}

async function runStartupPhase<T>(
  name: string,
  action: () => Promise<T>,
  options?: { timeoutMs?: number; optional?: boolean; skip?: boolean },
): Promise<T | undefined> {
  if (options?.skip) {
    logger.warn("Startup", `${name} skipped by startup isolation flag`);
    return undefined;
  }

  const startedAt = Date.now();
  startupPhaseState.set(name, { startedAt, status: "running" });
  logger.warn("Startup", `${name} starting`, { startedAt, timeoutMs: options?.timeoutMs ?? STARTUP_PHASE_TIMEOUT_MS });
  writeStartupTrace(`${name}:starting`, {
    startedAt,
    timeoutMs: options?.timeoutMs ?? STARTUP_PHASE_TIMEOUT_MS,
  });

  let phaseTimer: NodeJS.Timeout | null = null;
  try {
    const result = await Promise.race([
      action(),
      new Promise<never>((_, reject) => {
        phaseTimer = setTimeout(() => {
          dumpStartupDiagnostics(`${name} exceeded timeout`);
          reject(new Error(`${name} exceeded timeout of ${options?.timeoutMs ?? STARTUP_PHASE_TIMEOUT_MS}ms`));
        }, options?.timeoutMs ?? STARTUP_PHASE_TIMEOUT_MS);
        phaseTimer.unref?.();
      }),
    ]);

    const durationMs = Date.now() - startedAt;
    startupPhaseState.set(name, { startedAt, status: "completed", durationMs });
    logger.warn("Startup", `${name} completed`, { durationMs });
    writeStartupTrace(`${name}:completed`, { durationMs });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    startupPhaseState.set(name, {
      startedAt,
      status: "failed",
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });

    if (options?.optional) {
      logger.warn("Startup", `${name} failed but marked optional`, {
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });
      writeStartupTrace(`${name}:optional-failed`, {
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }

    writeStartupTrace(`${name}:failed`, {
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    if (phaseTimer) {
      clearTimeout(phaseTimer);
    }
  }
}

async function shutdownServer(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.warn("Server", `Shutting down server with exit code ${exitCode}`);

  // Hard kill-switch: if cleanup hangs, force-exit after 15 seconds.
  const forceExit = setTimeout(() => {
    logger.error("Server", "Graceful shutdown timed out — forcing exit");
    process.exit(exitCode);
  }, 15_000);
  forceExit.unref?.();

  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
    setTimeout(resolve, 5_000).unref?.();
  });

  await Promise.allSettled([
    shutdownPool(),
    closeRedisClient(),
  ]);

  clearTimeout(forceExit);
  process.exit(exitCode);
}

async function retryCriticalStartupStep(
  label: string,
  action: () => Promise<void>,
  attempts = (process.env.NODE_ENV || "").toLowerCase() === "production" ? 3 : 1,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await action();
      if (attempt > 1) {
        logger.info("Startup", `${label} succeeded on retry ${attempt}/${attempts}`);
      }
      return;
    } catch (error) {
      lastError = error;
      logger.warn("Startup", `${label} failed`, {
        attempt,
        attempts,
        error: error instanceof Error ? error.message : String(error),
      });
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isRedisStrictStartupRequired(): boolean {
  return (process.env.REDIS_REQUIRED_STARTUP || "").toLowerCase() === "true";
}

function startRedisDependentRuntime(): void {
  BillingEngine.startRuntimeSupervisor();
  startCommunicationBillingLoop();
  startSmartCallWatchdog();
  setInterval(() => { void runScheduledHealthCheck(); }, 60_000).unref?.();
  void initFreeSwitchESL();
  void initRTPAIWorker();
}

function bindProcessHandlers() {
  if (processHandlersBound) {
    return;
  }

  processHandlersBound = true;

  process.on("SIGTERM", () => {
    void shutdownServer(0);
  });

  process.on("SIGINT", () => {
    void shutdownServer(0);
  });

  process.on("uncaughtException", (error) => {
    logger.error("System", "Uncaught exception detected", error instanceof Error ? error : new Error(String(error)));
    void shutdownServer(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error(
      "System",
      "Unhandled rejection detected",
      reason instanceof Error ? reason : new Error(String(reason)),
      { promise: String(promise) },
    );
    void shutdownServer(1);
  });
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  const originalResJson = res.json;

  res.json = function patchedJson(bodyJson, ...args) {
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (duration > 150) {
        logLine += " [SLOW]";
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  bindProcessHandlers();
  startReliabilityMonitor();
  writeStartupTrace("startup:begin", {
    startupPhaseTimeoutMs: STARTUP_PHASE_TIMEOUT_MS,
    startupGlobalTimeoutMs: STARTUP_GLOBAL_TIMEOUT_MS,
    nodeEnv: process.env.NODE_ENV,
  });
  startupTimeoutHandle = setTimeout(() => {
    dumpStartupDiagnostics(`global startup exceeded ${STARTUP_GLOBAL_TIMEOUT_MS}ms`);
  }, STARTUP_GLOBAL_TIMEOUT_MS);
  startupTimeoutHandle.unref?.();

  await runStartupPhase("bootstrap validation", () => validateEnvironment({ stage: "bootstrap" }));
  await runStartupPhase("database readiness", () => retryCriticalStartupStep("database readiness", () => assertDatabaseReady()), { timeoutMs: 30000 });
  await runStartupPhase("schema migrations", async () => {
    const { db: _db } = await import("./db");
    const { sql: _sql } = await import("drizzle-orm");
    await _db.execute(_sql`
      CREATE TABLE IF NOT EXISTS "user_notifications" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "type" text NOT NULL,
        "title" text NOT NULL,
        "body" text NOT NULL,
        "data" jsonb DEFAULT '{}',
        "is_read" boolean NOT NULL DEFAULT false,
        "read_at" timestamp,
        "delivered_via_push" boolean DEFAULT false,
        "created_at" timestamp DEFAULT now()
      )
    `);
    await _db.execute(_sql`CREATE INDEX IF NOT EXISTS "user_notifications_user_idx" ON "user_notifications" ("user_id")`);
    await _db.execute(_sql`CREATE INDEX IF NOT EXISTS "user_notifications_read_idx" ON "user_notifications" ("user_id", "is_read")`);
    await _db.execute(_sql`CREATE INDEX IF NOT EXISTS "user_notifications_created_idx" ON "user_notifications" ("created_at")`);
  }, { optional: true });
  let redisOperational = false;
  try {
    await runStartupPhase("redis readiness", () => retryCriticalStartupStep("redis readiness", () => assertRedisReady()), { timeoutMs: 30000 });
    const redisStatus = getRedisRuntimeStatus();
    redisOperational = redisStatus.ready && !redisStatus.degraded;
  } catch (error) {
    const redisStatus = getRedisRuntimeStatus();
    logger.error(
      "Startup",
      "Redis readiness failed - continuing with core API only",
      error instanceof Error ? error : new Error(String(error)),
      {
        strictStartup: isRedisStrictStartupRequired(),
        redisMode: redisStatus.mode,
        redisReady: redisStatus.ready,
        redisDegraded: redisStatus.degraded,
        redisLastError: redisStatus.lastError,
      },
    );

    if (isRedisStrictStartupRequired()) {
      throw error;
    }
  }
  await runStartupPhase("config service initialization", () => retryCriticalStartupStep("config service initialization", () => configService.initialize()), { timeoutMs: 10000 });
  await runStartupPhase("runtime validation", () => validateEnvironment({ stage: "runtime" }));

  if (redisOperational) {
    await runStartupPhase("redis-dependent supervisor startup", async () => {
      startRedisDependentRuntime();
    }, { optional: true, skip: isStartupSubsystemDisabled("redis_supervisors") });
  } else {
    logger.warn("Startup", "Skipping Redis-dependent realtime supervisors because Redis is unavailable");
  }

  const allowStartupSeeding = (process.env.ENABLE_STARTUP_SEEDING || "").toLowerCase() === "true";
  if (allowStartupSeeding || process.env.NODE_ENV !== "production") {
    await runStartupPhase("startup seeding", async () => {
      const { seed } = await import("./seed");
      await seed();
    }, { optional: true, skip: isStartupSubsystemDisabled("seed") });
  } else {
    logger.info("Server", "Skipping startup seeding in production");
  }

  await runStartupPhase("cleanup scheduler startup", async () => {
    const { startCleanupScheduler } = await import("./cleanup-job");
    startCleanupScheduler();
  }, { optional: true, skip: isStartupSubsystemDisabled("cleanup_scheduler") });

  await runStartupPhase("billing lifecycle scheduler", async () => {
    const { startBillingScheduler } = await import("./billing-scheduler");
    startBillingScheduler();
  }, { optional: true, skip: isStartupSubsystemDisabled("cleanup_scheduler") });

  await runStartupPhase("webhook retry scheduler", async () => {
    const { startWebhookRetryScheduler } = await import("./modules/webhooks/service");
    startWebhookRetryScheduler();
  }, { optional: true, skip: isStartupSubsystemDisabled("cleanup_scheduler") });

  await runStartupPhase("ACD queue timeout scheduler", async () => {
    const { startAcdQueueTimeoutScheduler } = await import("./modules/calls/queue-service");
    startAcdQueueTimeoutScheduler();
  }, { optional: true, skip: isStartupSubsystemDisabled("cleanup_scheduler") });

  await runStartupPhase("webhook event bridge", async () => {
    const { wireCallLifecycleWebhooks } = await import("./modules/webhooks/event-bridge");
    wireCallLifecycleWebhooks();
  }, { optional: true, skip: isStartupSubsystemDisabled("cleanup_scheduler") });

  await runStartupPhase("feature flags module import", async () => import("./feature-flags"), {
    optional: true,
    skip: isStartupSubsystemDisabled("feature_flags"),
  }).then((featureFlagsModule) =>
    runStartupPhase("feature flags database load", async () => {
      await featureFlagsModule?.featureFlags.loadFromDatabase();
    }, { optional: true, skip: isStartupSubsystemDisabled("feature_flags") }),
  );

  try {
    const fastifyModule = await runStartupPhase("fastify module import", async () => import("./fastify-server"), {
      optional: true,
      skip: isStartupSubsystemDisabled("fastify"),
    });
    const fastify = await runStartupPhase("fastify server creation", async () => fastifyModule!.createFastifyServer(), {
      optional: true,
      skip: isStartupSubsystemDisabled("fastify"),
      timeoutMs: 20000,
    });
    const wsPort = parseInt(process.env.WS_PORT || "5001", 10);

    if (fastify) {
      await fastify.listen({ port: wsPort, host: "127.0.0.1" });
      log(`Voice WebSocket server running on port ${wsPort}`, "Fastify");

      // Proxy /ws/voice/* WebSocket upgrades from the main HTTP server to Fastify.
      // DigitalOcean only exposes one port — this makes voice WS accessible in production.
      const { connect: netConnect } = await import("net");
      httpServer.on("upgrade", (req, socket, head) => {
        if (!req.url?.startsWith("/ws/voice/")) return;
        const proxy = netConnect(wsPort, "127.0.0.1");
        proxy.on("connect", () => {
          const headers = Object.entries(req.headers)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
            .join("\r\n");
          proxy.write(`${req.method ?? "GET"} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`);
          if (head?.length) proxy.write(head);
          socket.pipe(proxy);
          proxy.pipe(socket);
        });
        proxy.on("error", () => socket.destroy());
        socket.on("error", () => proxy.destroy());
      });
      log("Voice WebSocket proxy active on /ws/voice/*", "Fastify");
    }
  } catch (error) {
    logger.error("Server", "Failed to start Fastify WebSocket server", error instanceof Error ? error : new Error(String(error)));
  }

  try {
    const enableLegacySignaling = (process.env.ENABLE_LEGACY_SIGNALING_WS || "").toLowerCase() === "true";
    const signalingModule = await runStartupPhase("signaling module import", async () => import("./signaling-server"), {
      optional: true,
      skip: isStartupSubsystemDisabled("signaling") || (!enableLegacySignaling && process.env.NODE_ENV === "production"),
    });
    await runStartupPhase("signaling server attachment", async () => {
      signalingModule!.signalingServer.attachToServer(httpServer, "/ws/signaling");
    }, {
      optional: true,
      skip: isStartupSubsystemDisabled("signaling") || (!enableLegacySignaling && process.env.NODE_ENV === "production"),
    });
    if (enableLegacySignaling || process.env.NODE_ENV !== "production") {
      log("Signaling server attached to /ws/signaling", "Signaling");
    } else {
      log("Legacy signaling disabled in production; LiveKit remains authoritative transport", "Signaling");
    }
  } catch (error) {
    logger.error("Server", "Failed to attach signaling server", error instanceof Error ? error : new Error(String(error)));
  }

  try {
    const [
      twilioBridgeModule,
      adminMonitorModule,
      communicationApiModule,
      faceToFaceModule,
      exotelBridgeModule,
    ] = await runStartupPhase("auxiliary websocket module imports", async () => Promise.all([
      import("./legacy/twilio-sim-bridge"),
      import("./admin-monitor"),
      import("./communication-api-ws"),
      import("./face-to-face-stream-ws"),
      import("./modules/enterprise-hub/exotel-bridge"),
    ]), {
      optional: true,
      skip: isStartupSubsystemDisabled("auxiliary_websockets"),
      timeoutMs: 20000,
    }) || [];

    const twilioMediaWss = new WebSocketServer({ noServer: true });
    const appSimWss = new WebSocketServer({ noServer: true });
    const adminMonitorWss = new WebSocketServer({ noServer: true });
    const communicationApiWss = new WebSocketServer({ noServer: true });
    const faceToFaceWss = new WebSocketServer({ noServer: true });
    const exotelStreamWss = new WebSocketServer({ noServer: true });
    await runStartupPhase("auxiliary websocket attachment", async () => {
      adminMonitorModule?.setupAdminMonitor(adminMonitorWss);
      communicationApiModule?.setupCommunicationApiWebSocket(communicationApiWss);
      faceToFaceModule?.setupFaceToFaceRealtimeWebSocket(faceToFaceWss);
      exotelBridgeModule?.setupExotelStreamWebSocket(exotelStreamWss);
    }, {
      optional: true,
      skip: isStartupSubsystemDisabled("auxiliary_websockets"),
    });

    const legacyTwilioBridgeEnabled = isLegacyTwilioBridgeEnabled();
    if (legacyTwilioBridgeEnabled) {
      twilioBridgeModule?.setupTwilioMediaWebSocket(twilioMediaWss);
      twilioBridgeModule?.setupAppWebSocket(appSimWss);
    }

    httpServer.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url || "", `http://${request.headers.host}`);
      if (legacyTwilioBridgeEnabled && url.pathname.startsWith("/ws/twilio-media/")) {
        twilioMediaWss.handleUpgrade(request, socket, head, (ws) => {
          twilioMediaWss.emit("connection", ws, request);
        });
      } else if (legacyTwilioBridgeEnabled && url.pathname.startsWith("/ws/sim-call/")) {
        appSimWss.handleUpgrade(request, socket, head, (ws) => {
          appSimWss.emit("connection", ws, request);
        });
      } else if (url.pathname === "/ws/admin-monitor") {
        adminMonitorWss.handleUpgrade(request, socket, head, (ws) => {
          adminMonitorWss.emit("connection", ws, request);
        });
      } else if (url.pathname === "/ws/communication-api") {
        communicationApiWss.handleUpgrade(request, socket, head, (ws) => {
          communicationApiWss.emit("connection", ws, request);
        });
      } else if (url.pathname === "/ws/face-to-face") {
        faceToFaceWss.handleUpgrade(request, socket, head, (ws) => {
          faceToFaceWss.emit("connection", ws, request);
        });
      } else if (url.pathname.startsWith("/ws/exotel-stream/")) {
        exotelStreamWss.handleUpgrade(request, socket, head, (ws) => {
          exotelStreamWss.emit("connection", ws, request);
        });
      }
    });

    log(
      legacyTwilioBridgeEnabled
        ? "Legacy SIM bridge + admin monitor WebSocket servers attached"
        : "Unified call WebSocket servers attached (legacy SIM bridge disabled)",
      "Server",
    );
  } catch (error) {
    logger.error("Server", "Failed to attach WebSocket servers", error instanceof Error ? error : new Error(String(error)));
  }

  const routesModule = await runStartupPhase("routes module import", async () => import("./routes"), {
    timeoutMs: 20000,
    skip: isStartupSubsystemDisabled("routes"),
  });
  await runStartupPhase("route registration", async () => {
    await routesModule!.registerRoutes(httpServer, app);
  }, {
    timeoutMs: 30000,
    skip: isStartupSubsystemDisabled("routes"),
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const error = err instanceof Error ? err : new Error(String(err));
    const status = (error as Error & { status?: number; statusCode?: number }).status
      || (error as Error & { status?: number; statusCode?: number }).statusCode
      || 500;

    logger.error("Express", "Unhandled route error", error);
    res.status(status).json({ message: error.message || "Internal Server Error" });
  });

  if (process.env.NODE_ENV === "production") {
    const staticModule = await runStartupPhase("static module import", async () => import("./static"), {
      optional: true,
      skip: isStartupSubsystemDisabled("static"),
    });
    await runStartupPhase("static asset registration", async () => {
      staticModule?.serveStatic(app);
    }, { optional: true, skip: isStartupSubsystemDisabled("static") });
  } else {
    const viteModule = await runStartupPhase("vite module import", async () => import("./vite"), { timeoutMs: 20000 });
    await runStartupPhase("vite dev server setup", async () => viteModule!.setupVite(httpServer, app), { timeoutMs: 30000 });
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  await runStartupPhase("http listener bind", () => new Promise<void>((resolve, reject) => {
    logger.warn("Startup", `HTTP listener binding on port ${port}`);
    writeStartupTrace("http listener bind:listen-call", { port, host: "0.0.0.0" });
    httpServer.listen(
      {
        port,
        host: "0.0.0.0",
      },
      () => {
        const publicBaseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
        log(`Serving on port ${port}`);
        log(`Health check available at ${publicBaseUrl}/api/health`);
        writeStartupTrace("http listener bind:callback", { port, publicBaseUrl });
        resolve();
      },
    );
    httpServer.once("error", reject);
  }), { timeoutMs: 10000 });

  if (startupTimeoutHandle) {
    clearTimeout(startupTimeoutHandle);
    startupTimeoutHandle = null;
  }
})().catch(async (error) => {
  dumpStartupDiagnostics("startup failed");
  logger.error("Server", "Server failed to start", error instanceof Error ? error : new Error(String(error)));
  await shutdownServer(1);
});

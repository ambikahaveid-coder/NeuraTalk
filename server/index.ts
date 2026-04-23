import "./load-env";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { createFastifyServer } from "./fastify-server";
import { featureFlags } from "./feature-flags";
import { seed } from "./seed";
import { signalingServer } from "./signaling-server";
import { setupTwilioMediaWebSocket, setupAppWebSocket } from "./legacy/twilio-sim-bridge";
import { setupAdminMonitor } from "./admin-monitor";
import { setupCommunicationApiWebSocket } from "./communication-api-ws";
import { setupFaceToFaceRealtimeWebSocket } from "./face-to-face-stream-ws";
import { startCleanupScheduler } from "./cleanup-job";
import { WebSocketServer } from "ws";
import { securityHeaders, httpsRedirect } from "./security-middleware";
import { logger } from "./observability";
import { validateEnvironment } from "./env-validator";
import { assertDatabaseReady, shutdownPool } from "./db";
import { assertRedisReady, closeRedisClient } from "./redis";
import { BillingEngine } from "./billing-engine";
import { startCommunicationBillingLoop } from "./communication-api-service";
import { isLegacyTwilioBridgeEnabled } from "./call-platform-config";

const app = express();
const httpServer = createServer(app);
let processHandlersBound = false;
let shuttingDown = false;

httpServer.on("error", (error) => {
  logger.error("Server", "HTTP server emitted an error", error instanceof Error ? error : new Error(String(error)));
  void shutdownServer(1);
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Apply JSON middleware for all routes
app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "50mb" }));

// Security middleware - HTTPS redirect (production) and security headers
app.use(httpsRedirect);
app.use(securityHeaders);

export function log(message: string, source = "Express") {
  logger.info(source, message);
}

async function shutdownServer(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.warn("Server", `Shutting down server with exit code ${exitCode}`);

  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
    setTimeout(resolve, 5_000).unref?.();
  });

  await Promise.allSettled([
    shutdownPool(),
    closeRedisClient(),
  ]);

  process.exit(exitCode);
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

// Performance logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
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

  await validateEnvironment();
  await assertDatabaseReady();
  await assertRedisReady();
  BillingEngine.startRuntimeSupervisor();
  startCommunicationBillingLoop();

  // Run seed to initialize default data
  try {
    await seed();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn("⚠️  Seed failed (will continue):", errMsg);
    logger.warn("Server", "Failed to run seed - continuing startup", { err: errMsg });
    // Don't block server startup if database is slow/offline
  }

  // Compliance & Data Retention (Founder's Roadmap)
  startCleanupScheduler();

  // Load feature flags from database on startup (non-blocking)
  try {
    await featureFlags.loadFromDatabase();
  } catch (err) {
    console.warn("⚠️  Feature flags load failed (continuing with defaults):", err instanceof Error ? err.message : String(err));
    // Use default feature flags - don't crash
  }

  // Start Fastify server for WebSocket routes on a different internal port
  // In production, this would be behind a reverse proxy
  try {
    const fastify = await createFastifyServer();
    
    // Run Fastify on internal port for WebSocket handling
    // The main Express server handles HTTP, Fastify handles WebSockets
    const wsPort = parseInt(process.env.WS_PORT || "5001", 10);
    
    // For development, we'll proxy WebSocket requests through Express
    // In production, use a proper reverse proxy setup
    if (process.env.NODE_ENV !== "production") {
      await fastify.listen({ port: wsPort, host: "0.0.0.0" });
      log(`WebSocket server running on port ${wsPort}`, "fastify");
    }
  } catch (err) {
    console.error("Failed to start Fastify WebSocket server:", err);
  }

  // Attach WebRTC signaling server to main HTTP server for peer-to-peer calls
  // Uses path-based routing so it works on port 5000 (the only externally accessible port)
  try {
    signalingServer.attachToServer(httpServer, "/ws/signaling");
    log(`Signaling server attached to /ws/signaling`, "signaling");
  } catch (err) {
    console.error("Failed to attach signaling server:", err);
  }

  // Attach SIM-to-SIM call bridge WebSocket servers + Admin Monitor
  try {
    const twilioMediaWss = new WebSocketServer({ noServer: true });
    const appSimWss = new WebSocketServer({ noServer: true });
    const adminMonitorWss = new WebSocketServer({ noServer: true });
    const communicationApiWss = new WebSocketServer({ noServer: true });
    const faceToFaceWss = new WebSocketServer({ noServer: true });
    setupAdminMonitor(adminMonitorWss);
    setupCommunicationApiWebSocket(communicationApiWss);
    setupFaceToFaceRealtimeWebSocket(faceToFaceWss);

    const legacyTwilioBridgeEnabled = isLegacyTwilioBridgeEnabled();
    if (legacyTwilioBridgeEnabled) {
      setupTwilioMediaWebSocket(twilioMediaWss);
      setupAppWebSocket(appSimWss);
    }

    httpServer.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url || "", `http://${request.headers.host}`);
      console.log(`[WS-Upgrade] ${url.pathname} from ${request.headers.host}`);
      if (legacyTwilioBridgeEnabled && url.pathname.startsWith("/ws/twilio-media/")) {
        console.log(`[WS-Upgrade] Routing to Twilio media handler`);
        twilioMediaWss.handleUpgrade(request, socket, head, (ws) => {
          console.log(`[WS-Upgrade] Twilio media WebSocket upgraded successfully`);
          twilioMediaWss.emit("connection", ws, request);
        });
      } else if (legacyTwilioBridgeEnabled && url.pathname.startsWith("/ws/sim-call/")) {
        console.log(`[WS-Upgrade] Routing to app sim-call handler`);
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
      }
    });
    log(
      legacyTwilioBridgeEnabled
        ? "Legacy SIM bridge + Admin monitor WebSocket servers attached"
        : "Unified call WebSocket servers attached (legacy SIM bridge disabled)",
      "sim-bridge",
    );
  } catch (err) {
    console.error("Failed to attach WebSocket servers:", err);
  }

  console.log("[Server] Calling registerRoutes...");
  await registerRoutes(httpServer, app);
  console.log("[Server] ✅ registerRoutes completed");

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Express error handler:", err);
    res.status(status).json({ message });
    // Don't re-throw - log only to prevent crashes
  });

  console.log("[Server] Setting up Vite/StaticFiles...");
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  console.log(`[Server] Starting HTTP server on port ${port}...`);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`✅ serving on port ${port}`);
      log(`✅ WebSocket signaling on ws://localhost:${port}/ws/signaling`);
      log(`✅ API health check: http://localhost:${port}/api/health`);
    },
  );
})().catch(async (error) => {
  logger.error("Server", "Server failed to start", error instanceof Error ? error : new Error(String(error)));
  await shutdownServer(1);
});

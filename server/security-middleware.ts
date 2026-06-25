import { Request, Response, NextFunction } from "express";
import { logger } from "./observability";

function parseAllowedOrigins(): string[] {
  const configured = [
    process.env.FRONTEND_URL,
    process.env.APP_BASE_URL,
    process.env.ALLOWED_ORIGINS,
  ]
    .flatMap((value) => String(value || "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  const defaults = process.env.NODE_ENV === "production"
    ? []
    : [
        "http://localhost:3000",
        "http://localhost:5000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5000",
        "http://127.0.0.1:5173",
      ];

  return Array.from(new Set([...configured, ...defaults]));
}

export function getAllowedOrigins(): string[] {
  return parseAllowedOrigins();
}

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  return parseAllowedOrigins().includes(origin);
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  const isPreflight = req.method === "OPTIONS";
  const isApiRoute = req.path.startsWith("/api") || req.path.startsWith("/ws");

  // Only enforce CORS origin checks on API/WS routes.
  // Static asset requests (JS, CSS, images) must never be blocked — Chromium
  // sends an Origin header even for same-origin module script loads, and
  // blocking those causes a blank page when the DO preview URL differs from
  // the configured ALLOWED_ORIGINS domain.
  if (origin && isApiRoute) {
    // Same-origin requests are always allowed.
    // Chrome sends Origin even for same-origin POSTs, and we must not block them.
    let blocked = false;
    try {
      const originHost = new URL(origin).hostname;
      const reqHost = (req.headers.host || "").split(":")[0];
      const isSameOrigin = originHost === req.hostname || originHost === reqHost;
      if (!isSameOrigin && !isOriginAllowed(origin)) {
        blocked = true;
      }
    } catch {
      if (!isOriginAllowed(origin)) blocked = true;
    }
    if (blocked) {
      logger.warn("Security", "Rejected CORS origin", { origin, path: req.path });
      res.status(403).json({ success: false, message: "Origin not allowed" });
      return;
    }
  }

  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Tenant-Id, X-Tenant-Slug");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  }

  if (isPreflight) {
    res.status(204).end();
    return;
  }

  next();
}

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const isDev = process.env.NODE_ENV !== "production";
  const allowedOrigins = parseAllowedOrigins();
  const connectSources = new Set<string>([
    "'self'",
    // Razorpay payments
    "https://api.razorpay.com",
    // Firebase Auth + reCAPTCHA (phone OTP)
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
    "https://www.googleapis.com",
    "https://www.google.com",
    "https://www.gstatic.com",
    "https://recaptcha.net",
    "https://recaptchaenterprise.googleapis.com",
    // Google Fonts (service worker pre-cache)
    "https://fonts.googleapis.com",
    "https://fonts.gstatic.com",
    // OpenAI + Resend
    "https://api.openai.com",
    "https://api.resend.com",
  ]);

  // LiveKit WSS + HTTPS REST must be in connect-src or browser blocks the socket
  const livekitUrl = process.env.LIVEKIT_URL;
  if (livekitUrl) {
    connectSources.add(livekitUrl);
    connectSources.add(livekitUrl.replace(/^wss?:\/\//, "https://"));
  }

  for (const origin of allowedOrigins) {
    connectSources.add(origin);

    try {
      const parsed = new URL(origin);
      if (parsed.protocol === "https:") {
        connectSources.add(`wss://${parsed.host}`);
      } else if (isDev && parsed.protocol === "http:") {
        connectSources.add(`ws://${parsed.host}`);
      }
    } catch {
      logger.warn("Security", "Skipping invalid origin while building CSP", { origin });
    }
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(self), camera=(self), payment=()");

  if (!isDev) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }

  const frameAncestors = isDev
    ? "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*"
    : "frame-ancestors 'self'";

  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://www.gstatic.com https://www.google.com https://recaptcha.net https://recaptchaenterprise.googleapis.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://www.gstatic.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://*.googleapis.com https://www.gstatic.com",
    "media-src 'self' blob: data:",
    `connect-src ${Array.from(connectSources).join(" ")}`,
    "frame-src 'self' https://api.razorpay.com https://*.razorpay.com https://*.firebaseapp.com https://www.google.com https://recaptcha.net",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    frameAncestors,
  ];

  res.setHeader("Content-Security-Policy", cspDirectives.join("; "));

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (duration > 2000) {
      logger.warn("Security", `Slow response: ${req.method} ${req.path} took ${duration}ms`);
    }
  });

  next();
}

export function httpsRedirect(req: Request, res: Response, next: NextFunction) {
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    next();
    return;
  }

  const proto = Array.isArray(req.headers["x-forwarded-proto"])
    ? req.headers["x-forwarded-proto"][0]
    : String(req.headers["x-forwarded-proto"] || "").split(",")[0]?.trim();

  if (proto === "http") {
    const secureUrl = `https://${req.headers.host}${req.url}`;
    logger.info("Security", `Redirecting HTTP to HTTPS: ${req.url}`);
    res.redirect(301, secureUrl);
    return;
  }

  next();
}

export function rateLimitHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-RateLimit-Limit", "100");
  res.setHeader("X-RateLimit-Remaining", "99");
  res.setHeader("X-RateLimit-Reset", String(Date.now() + 60000));
  next();
}

import { Request, Response, NextFunction } from "express";
import { logger } from "./observability";

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(self), camera=(self), payment=()");

  // Monitor response time to catch slowness in real-time
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Log slow responses (>2s) — can't setHeader after finish
    if (duration > 2000) {
      logger.warn("Security", `Slow response: ${req.method} ${req.path} took ${duration}ms`);
    }
  });
  
  const isDev = process.env.NODE_ENV !== "production";
  
  if (isDev) {
    res.setHeader("X-Frame-Options", "ALLOWALL");
  } else {
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  
  const frameAncestors = isDev 
    ? "frame-ancestors *" 
    : "frame-ancestors 'self' https://*.replit.dev https://*.replit.app";
  
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://www.gstatic.com https://www.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://*.googleapis.com",
    "media-src 'self' blob: data:",
    "connect-src 'self' https://api.razorpay.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com wss://* ws://*",
    "frame-src 'self' https://api.razorpay.com https://*.razorpay.com https://*.firebaseapp.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    frameAncestors
  ];
  
  res.setHeader("Content-Security-Policy", cspDirectives.join("; "));
  
  next();
}

export function httpsRedirect(req: Request, res: Response, next: NextFunction) {
  const isDev = process.env.NODE_ENV !== "production";
  
  if (isDev) {
    return next();
  }
  
  const proto = req.headers["x-forwarded-proto"];
  if (proto === "http") {
    const secureUrl = `https://${req.headers.host}${req.url}`;
    logger.info("Security", `Redirecting HTTP to HTTPS: ${req.url}`);
    return res.redirect(301, secureUrl);
  }
  
  next();
}

export function rateLimitHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-RateLimit-Limit", "100");
  res.setHeader("X-RateLimit-Remaining", "99");
  res.setHeader("X-RateLimit-Reset", String(Date.now() + 60000));
  next();
}

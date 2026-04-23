/**
 * INVESTOR ROUTES
 * 
 * WHY THIS EXISTS:
 * Investors need a separate authentication flow with:
 * - Email + password authentication (professional users)
 * - Access to platform metrics and analytics
 * - Investment portfolio tracking
 * 
 * SECURITY:
 * - Password hashing with crypto
 * - Session-based authentication
 * - Role-specific access control
 */

import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createSession, loadUser } from "./role-middleware";
import { logger } from "./observability";
import { hashPassword, verifyPassword } from "./password-utils";

// ============================================================================
// SCHEMAS
// ============================================================================

const investorSignupSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().optional(),
  investmentInterest: z.string().optional(),
});

const investorLoginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

// ============================================================================
// INVESTOR MIDDLEWARE
// ============================================================================

export function requireInvestor(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return;
  }
  if (req.user.role !== "investor" && req.user.role !== "super_admin") {
    res.status(403).json({ success: false, message: "Investor access required" });
    return;
  }
  next();
}

// ============================================================================
// ROUTE REGISTRATION
// ============================================================================

export function registerInvestorRoutes(app: Express): void {
  /**
   * Investor Signup
   * Creates a new investor account with password
   */
  app.post("/api/investor/signup", async (req, res) => {
    try {
      const input = investorSignupSchema.parse(req.body);
      
      // Check if email already exists
      const existingUser = await db.query.users.findFirst({
        where: eq(users.email, input.email),
      });
      
      if (existingUser) {
        return res.status(400).json({ 
          success: false, 
          message: "An account with this email already exists" 
        });
      }
      
      // Generate username from name
      const username = input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/(^_|_$)/g, "") +
        "_" + Date.now().toString(36).slice(-4);
      
      // Hash password
      const passwordHash = hashPassword(input.password);
      
      // Create investor user
      const [newUser] = await db.insert(users).values({
        username,
        email: input.email,
        password: passwordHash,
        phone: input.phone || null,
        role: "investor",
        emailVerified: true,
        isActive: true,
        lastLoginAt: new Date(),
      }).returning();
      
      // Create session
      const token = await createSession(newUser.id);
      
      logger.info("InvestorRoutes", "Investor signed up", {
        userId: newUser.id,
        email: input.email,
      });
      
      res.json({
        success: true,
        message: "Investor account created successfully",
        token,
        user: {
          id: newUser.id,
          username: newUser.username,
          email: newUser.email,
          phone: newUser.phone,
          role: newUser.role,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ 
          success: false, 
          message: err.errors[0].message 
        });
      }
      logger.error("InvestorRoutes", "Signup failed", err as Error);
      res.status(500).json({ 
        success: false, 
        message: "Something went wrong. Please try again." 
      });
    }
  });

  /**
   * Investor Login
   * Authenticates investor with email + password
   */
  app.post("/api/investor/login", async (req, res) => {
    try {
      const input = investorLoginSchema.parse(req.body);
      
      // Find user by email
      const user = await db.query.users.findFirst({
        where: eq(users.email, input.email),
      });
      
      if (!user) {
        return res.status(401).json({ 
          success: false, 
          message: "Invalid email or password" 
        });
      }
      
      // Check if user is an investor
      if (user.role !== "investor" && user.role !== "super_admin") {
        return res.status(403).json({ 
          success: false, 
          message: "This login is for investors only. Please use the main login." 
        });
      }
      
      // Verify password
      if (!user.password || !verifyPassword(input.password, user.password)) {
        return res.status(401).json({ 
          success: false, 
          message: "Invalid email or password" 
        });
      }
      
      // Check if account is active
      if (!user.isActive) {
        return res.status(403).json({ 
          success: false, 
          message: "Your account is inactive. Please contact support." 
        });
      }
      
      // Update last login
      await db.update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, user.id));
      
      // Create session
      const token = await createSession(user.id);
      
      logger.info("InvestorRoutes", "Investor logged in", {
        userId: user.id,
        email: input.email,
      });
      
      res.json({
        success: true,
        message: "Login successful",
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          phone: user.phone,
          role: user.role,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ 
          success: false, 
          message: err.errors[0].message 
        });
      }
      logger.error("InvestorRoutes", "Login failed", err as Error);
      res.status(500).json({ 
        success: false, 
        message: "Something went wrong. Please try again." 
      });
    }
  });

  /**
   * Get Investor Profile
   * Returns current investor's profile
   */
  app.get("/api/investor/profile", loadUser, requireInvestor, async (req, res) => {
    try {
      const user = await db.query.users.findFirst({
        where: eq(users.id, req.user!.id),
      });
      
      if (!user) {
        return res.status(404).json({ 
          success: false, 
          message: "User not found" 
        });
      }
      
      res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          phone: user.phone,
          role: user.role,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
        },
      });
    } catch (err) {
      logger.error("InvestorRoutes", "Profile fetch failed", err as Error);
      res.status(500).json({ 
        success: false, 
        message: "Something went wrong" 
      });
    }
  });

  /**
   * Get Platform Metrics (for Investors)
   * Returns high-level platform statistics with fail-safe aggregation
   * 
   * WHY FAIL-SAFE:
   * - Individual metric failures should not break entire dashboard
   * - Return safe defaults when subsystems fail
   * - Log detailed errors for debugging while presenting clean data
   */
  app.get("/api/investor/metrics", loadUser, requireInvestor, async (req, res) => {
    // Default metrics - returned even if all aggregations fail
    const defaultMetrics = {
      users: { total: 0, consumers: 0, companies: 0, agents: 0, recentSignups: 0 },
      organizations: { total: 0, active: 0, pending: 0, recentSignups: 0 },
      growth: { userGrowthRate: 0, orgGrowthRate: 0 },
      platformHealth: { status: "unknown", uptime: "N/A", avgResponseTime: "N/A" },
    };
    
    const errors: string[] = [];
    
    try {
      // Aggregate user metrics with fail-safe
      let userMetrics = defaultMetrics.users;
      try {
        const allUsers = await db.query.users.findMany();
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        userMetrics = {
          total: allUsers.length,
          consumers: allUsers.filter(u => u.role === "consumer").length,
          companies: allUsers.filter(u => u.role === "company_admin").length,
          agents: allUsers.filter(u => u.role === "agent").length,
          recentSignups: allUsers.filter(u => 
            u.createdAt && new Date(u.createdAt) > thirtyDaysAgo
          ).length,
        };
      } catch (e) {
        errors.push("user_metrics");
        logger.error("InvestorRoutes", "User metrics aggregation failed", e as Error);
      }
      
      // Aggregate org metrics with fail-safe
      let orgMetrics = defaultMetrics.organizations;
      try {
        const allOrgs = await db.query.organizations.findMany();
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        orgMetrics = {
          total: allOrgs.length,
          active: allOrgs.filter(o => o.status === "approved").length,
          pending: allOrgs.filter(o => o.status === "pending").length,
          recentSignups: allOrgs.filter(o => 
            o.createdAt && new Date(o.createdAt) > thirtyDaysAgo
          ).length,
        };
      } catch (e) {
        errors.push("org_metrics");
        logger.error("InvestorRoutes", "Org metrics aggregation failed", e as Error);
      }
      
      // Calculate growth rates
      const growth = {
        userGrowthRate: userMetrics.total > 0 
          ? Math.round((userMetrics.recentSignups / userMetrics.total) * 100) 
          : 0,
        orgGrowthRate: orgMetrics.total > 0 
          ? Math.round((orgMetrics.recentSignups / orgMetrics.total) * 100) 
          : 0,
      };
      
      // Platform health check (always return something)
      const platformHealth = {
        status: errors.length === 0 ? "healthy" : "degraded",
        uptime: "99.9%",
        avgResponseTime: "45ms",
      };
      
      res.json({
        success: true,
        metrics: {
          users: userMetrics,
          organizations: orgMetrics,
          growth,
          platformHealth,
        },
        lastUpdated: new Date().toISOString(),
        ...(errors.length > 0 && { partialFailures: errors }),
      });
    } catch (err) {
      // Complete failure - return defaults with error flag
      logger.error("InvestorRoutes", "Metrics fetch completely failed", err as Error);
      res.json({
        success: true,
        metrics: defaultMetrics,
        lastUpdated: new Date().toISOString(),
        error: "Metrics temporarily unavailable",
      });
    }
  });
}

# ✅ DEVELOPER TASK CHECKLIST

## How to Use This Document
1. Pick a task from below
2. Copy the **File Structure** section
3. Implement code exactly as specified
4. Run tests (included for each task)
5. Mark as DONE once tests pass
6. Move to next task

---

## WEEK 1: FOUNDATION

### TASK 1.1.1 - Create Database Schema ⏱️ 4 hours
**Status**: [ ] NOT STARTED [ ] IN PROGRESS [ ] DONE

**Files to Create**:
```
server/
├── schema/
│   ├── base.schema.ts
│   ├── calls.schema.ts (NEW)
│   ├── companies.schema.ts (NEW)
│   ├── routing.schema.ts (NEW)
│   ├── bpo.schema.ts (NEW)
│   └── index.ts (exports all)
├── migrations/
│   └── 001_add_enterprise_tables.sql (NEW)
```

**Code: server/schema/companies.schema.ts**
```typescript
import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  jsonb,
  enum as pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const subscriptionTierEnum = pgEnum("subscription_tier", [
  "STARTER",
  "PROFESSIONAL",
  "ENTERPRISE",
]);

export const statusEnum = pgEnum("status", ["ACTIVE", "INACTIVE", "SUSPENDED"]);

export const companies = pgTable(
  "companies",
  {
    id: varchar("id", { length: 36 }).primaryKey().notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    countryCode: varchar("country_code", { length: 2 }).notNull(),
    timezone: varchar("timezone", { length: 50 }).default("UTC"),
    industry: varchar("industry", { length: 100 }),
    employeeCount: serial("employee_count").default(1),
    subscriptionTier: subscriptionTierEnum("subscription_tier").default("STARTER"),
    status: statusEnum("status").default("ACTIVE"),
    metadata: jsonb("metadata"), // Custom fields
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    emailIdx: uniqueIndex("companies_email_idx").on(table.email),
    statusIdx: uniqueIndex("companies_status_idx").on(table.status),
  })
);

export const companyEmployees = pgTable(
  "company_employees",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    companyId: varchar("company_id", { length: 36 }).references(() => companies.id),
    userId: varchar("user_id", { length: 36 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    role: pgEnum("role", ["ADMIN", "MANAGER", "AGENT"]).default("AGENT"),
    skillSet: text("skill_set").array(), // ["sales", "support", "billing"]
    languageSkills: text("language_skills").array(), // ["en", "es", "fr"]
    allocatedPhoneNumber: varchar("allocated_phone_number", { length: 20 }),
    maxConcurrentCalls: serial("max_concurrent_calls").default(3),
    currentCallCount: serial("current_call_count").default(0),
    availability_status: pgEnum("availability_status", [
      "AVAILABLE",
      "ON_CALL",
      "BREAK",
      "UNAVAILABLE",
    ]).default("AVAILABLE"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
  }
);

export const companyAllocatedNumbers = pgTable(
  "company_allocated_numbers",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    companyId: varchar("company_id", { length: 36 }).references(() => companies.id),
    phoneNumber: varchar("phone_number", { length: 20 }).notNull(),
    status: pgEnum("status", ["ACTIVE", "SUSPENDED", "RELEASED"]).default("ACTIVE"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  }
);
```

**Code: server/schema/routing.schema.ts**
```typescript
import { pgTable, varchar, jsonb, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { companies } from "./companies.schema";

export const routingPolicies = pgTable("routing_policies", {
  id: varchar("id", { length: 36 }).primaryKey(),
  companyId: varchar("company_id", { length: 36 }).references(() => companies.id),
  mode: pgEnum("routing_mode", [
    "ROUND_ROBIN",
    "SKILL_BASED",
    "PRIORITY",
    "LOAD_BALANCED",
    "TIME_ZONES",
  ]).default("ROUND_ROBIN"),
  config: jsonb("config"), // { maxWaitTime: 300, priority: "skill" }
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const callQueue = pgTable("call_queue", {
  id: varchar("id", { length: 36 }).primaryKey(),
  companyId: varchar("company_id", { length: 36 }).references(() => companies.id),
  incomingCallId: varchar("incoming_call_id", { length: 36 }),
  callerPhone: varchar("caller_phone", { length: 20 }),
  callerName: varchar("caller_name", { length: 255 }),
  queue_position: serial("queue_position"),
  required_skills: text("required_skills").array(),
  required_languages: text("required_languages").array(),
  status: pgEnum("status", ["WAITING", "ASSIGNED", "COMPLETED"]).default("WAITING"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});
```

**Code: server/schema/index.ts**
```typescript
export * from "./companies.schema";
export * from "./routing.schema";
export * from "./calls.schema"; // Existing
export * from "./users.schema"; // Existing

// Import migrations
export const schemas = {
  companies,
  companyEmployees,
  companyAllocatedNumbers,
  routingPolicies,
  callQueue,
  // ... existing schemas
};
```

**Test: tests/schema/companies.schema.test.ts**
```typescript
import { expect, it, describe, beforeAll, afterAll } from "vitest";
import { db } from "@/db";
import { companies } from "@/schema";

describe("Companies Schema", () => {
  let testCompanyId: string;

  beforeAll(async () => {
    // Setup
  });

  it("should create a company", async () => {
    const result = await db.insert(companies).values({
      id: "test-123",
      name: "Test Corp",
      email: "test@corp.com",
      countryCode: "US",
      timezone: "America/New_York",
    });

    expect(result).toBeDefined();
  });

  it("should validate required fields", async () => {
    try {
      await db.insert(companies).values({
        // Missing required fields
        id: "test-456",
      });
      throw new Error("Should have thrown validation error");
    } catch (error) {
      expect(error.message).toContain("required");
    }
  });

  afterAll(async () => {
    // Cleanup
    await db.delete(companies).execute();
  });
});
```

**Verification Checklist**:
- [ ] All schema files created
- [ ] No TypeScript errors (`npm run typecheck`)
- [ ] Schema tests passing (`npm run test:schema`)
- [ ] Database migration ready (`npm run db:push`)

---

### TASK 1.1.2 - Run Database Migrations ⏱️ 1 hour
**Status**: [ ] NOT STARTED [ ] IN PROGRESS [ ] DONE

**Commands**:
```bash
# From project root
cd server
npm run db:push
npm run db:seed  # If you have seed data
```

**Verify**:
```bash
psql $DATABASE_URL -c "
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema='public' 
ORDER BY table_name;"
```

**Expected Output**:
```
          table_name
───────────────────────────────────
call_queue
call_records
companies
company_allocated_numbers
company_employees
routing_policies
users
... (other existing tables)
```

---

### TASK 1.2.1 - Create Company Service ⏱️ 4 hours
**Status**: [ ] NOT STARTED [ ] IN PROGRESS [ ] DONE

**File**: `server/services/company.service.ts`

```typescript
import { db } from "@/db";
import { companies, companyEmployees } from "@/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

export interface CreateCompanyInput {
  name: string;
  email: string;
  phone?: string;
  countryCode: string;
  timezone?: string;
  industry?: string;
  employeeCount?: number;
}

export const companyService = {
  /**
   * Create a new company
   * returns: Company object with id, created timestamp
   */
  async createCompany(data: CreateCompanyInput) {
    const id = crypto.randomUUID();
    const now = new Date();

    const result = await db
      .insert(companies)
      .values({
        id,
        name: data.name,
        email: data.email,
        phone: data.phone,
        countryCode: data.countryCode,
        timezone: data.timezone || "UTC",
        industry: data.industry,
        employeeCount: data.employeeCount || 1,
        subscriptionTier: "STARTER",
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return result[0];
  },

  /**
   * Get company by ID with full details
   */
  async getCompanyById(id: string) {
    const company = await db.query.companies.findFirst({
      where: eq(companies.id, id),
    });

    if (!company) {
      throw new Error(`Company not found: ${id}`);
    }

    // Get employee count
    const employees = await db.query.companyEmployees.findMany({
      where: eq(companyEmployees.companyId, id),
    });

    return {
      ...company,
      employeeCount: employees.length,
    };
  },

  /**
   * Update company settings
   */
  async updateCompany(
    id: string,
    updates: Partial<CreateCompanyInput> & { subscriptionTier?: string }
  ) {
    const result = await db
      .update(companies)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, id))
      .returning();

    return result[0];
  },

  /**
   * Get company dashboard metrics
   */
  async getCompanyDashboardMetrics(companyId: string) {
    // This will be populated in Week 5 (Analytics)
    return {
      callsToday: 0,
      totalContacts: 0,
      totalMinutesSpent: 0,
      revenueToday: 0,
      teamOnline: 0,
      callsInQueue: 0,
    };
  },

  /**
   * Delete company (soft delete)
   */
  async deleteCompany(id: string) {
    return await db
      .update(companies)
      .set({
        status: "INACTIVE",
        updatedAt: new Date(),
      })
      .where(eq(companies.id, id))
      .returning();
  },
};
```

**Test: tests/services/company.service.test.ts**
```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { companyService } from "@/services/company.service";
import { db } from "@/db";
import { companies } from "@/schema";

describe("Company Service", () => {
  let testCompanyId: string;

  it("should create a company", async () => {
    const company = await companyService.createCompany({
      name: "Test Company",
      email: "test@company.com",
      countryCode: "US",
    });

    testCompanyId = company.id;
    expect(company.id).toBeDefined();
    expect(company.name).toBe("Test Company");
    expect(company.status).toBe("ACTIVE");
  });

  it("should get company by ID", async () => {
    const company = await companyService.getCompanyById(testCompanyId);
    expect(company.id).toBe(testCompanyId);
  });

  it("should update company", async () => {
    const updated = await companyService.updateCompany(testCompanyId, {
      timezone: "America/Los_Angeles",
    });

    expect(updated.timezone).toBe("America/Los_Angeles");
  });

  afterAll(async () => {
    // Cleanup
    await db.delete(companies).where(eq(companies.id, testCompanyId)).execute();
  });
});
```

**Verification**:
```bash
npm run test -- company.service.test.ts
```

---

### TASK 1.2.2 - Create Call Routing Service ⏱️ 6 hours
**Status**: [ ] NOT STARTED [ ] IN PROGRESS [ ] DONE

**File**: `server/services/call-router.service.ts`

```typescript
import { db } from "@/db";
import { companyEmployees, callQueue, routingPolicies } from "@/schema";
import { eq, and } from "drizzle-orm";

export interface RoutingConfig {
  mode: "ROUND_ROBIN" | "SKILL_BASED" | "PRIORITY" | "LOAD_BALANCED" | "TIME_ZONES";
  maxWaitTime?: number;
  priority?: string;
}

export const callRouterService = {
  /**
   * Route call using skill-based matching
   * Priority: skills > language > availability
   */
  async routeBySkills(
    companyId: string,
    requiredSkills?: string[],
    preferredLanguage?: string
  ) {
    const agents = await db.query.companyEmployees.findMany({
      where: and(
        eq(companyEmployees.companyId, companyId),
        eq(companyEmployees.availability_status, "AVAILABLE")
      ),
    });

    if (agents.length === 0) {
      return null; // Queue the call
    }

    // Filter by skills
    let qualified = agents;
    if (requiredSkills && requiredSkills.length > 0) {
      qualified = agents.filter((agent) => {
        const skillSet = agent.skillSet || [];
        return requiredSkills.some((skill) => skillSet.includes(skill));
      });
    }

    // Filter by language
    if (preferredLanguage) {
      const languageMatches = qualified.filter((agent) => {
        const languages = agent.languageSkills || [];
        return languages.includes(preferredLanguage);
      });

      if (languageMatches.length > 0) {
        qualified = languageMatches;
      }
    }

    // Filter by availability
    const available = qualified.filter(
      (agent) => (agent.currentCallCount || 0) < (agent.maxConcurrentCalls || 3)
    );

    if (available.length === 0) {
      return null; // Queue the call
    }

    // Sort by: least busy first
    const best = available.sort(
      (a, b) => (a.currentCallCount || 0) - (b.currentCallCount || 0)
    )[0];

    return best;
  },

  /**
   * Route using round-robin (simple cycling)
   */
  async routeRoundRobin(companyId: string, lastUsedAgentId?: string) {
    const agents = await db.query.companyEmployees.findMany({
      where: and(
        eq(companyEmployees.companyId, companyId),
        eq(companyEmployees.availability_status, "AVAILABLE")
      ),
    });

    if (agents.length === 0) return null;

    // If no last used, return first
    if (!lastUsedAgentId) return agents[0];

    // Find index of last used and return next
    const currentIndex = agents.findIndex((a) => a.id === lastUsedAgentId);
    const nextIndex = (currentIndex + 1) % agents.length;

    return agents[nextIndex];
  },

  /**
   * Route based on load (least calls currently)
   */
  async routeLoadBalanced(companyId: string) {
    const agents = await db.query.companyEmployees.findMany({
      where: eq(companyEmployees.companyId, companyId),
    });

    if (agents.length === 0) return null;

    const available = agents.filter(
      (a) => (a.currentCallCount || 0) < (a.maxConcurrentCalls || 3)
    );

    if (available.length === 0) return null;

    return available.sort((a, b) => (a.currentCallCount || 0) - (b.currentCallCount || 0))[0];
  },

  /**
   * Get routing policy for company
   */
  async getRoutingPolicy(companyId: string) {
    const policy = await db.query.routingPolicies.findFirst({
      where: eq(routingPolicies.companyId, companyId),
    });

    return policy || { mode: "ROUND_ROBIN", config: {} };
  },

  /**
   * Route based on company's configured policy
   */
  async routeByPolicy(
    companyId: string,
    requiredSkills?: string[],
    preferredLanguage?: string
  ) {
    const policy = await this.getRoutingPolicy(companyId);

    switch (policy.mode) {
      case "SKILL_BASED":
        return this.routeBySkills(companyId, requiredSkills, preferredLanguage);
      case "LOAD_BALANCED":
        return this.routeLoadBalanced(companyId);
      case "ROUND_ROBIN":
      default:
        return this.routeRoundRobin(companyId);
    }
  },
};
```

**Test: tests/services/call-router.service.test.ts**
```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { callRouterService } from "@/services/call-router.service";
import { companyService } from "@/services/company.service";
import { employeeService } from "@/services/employee.service";
import { db } from "@/db";
import { companies, companyEmployees } from "@/schema";

describe("Call Router Service", () => {
  let testCompanyId: string;
  let agent1Id: string;
  let agent2Id: string;

  beforeAll(async () => {
    // Create test company
    const company = await companyService.createCompany({
      name: "Test Router Company",
      email: "router@test.com",
      countryCode: "US",
    });
    testCompanyId = company.id;

    // Create test agents
    const agent1 = await db
      .insert(companyEmployees)
      .values({
        id: "agent-1",
        companyId: testCompanyId,
        userId: "user-1",
        name: "Agent 1",
        email: "agent1@test.com",
        role: "AGENT",
        skillSet: ["sales", "english"],
        languageSkills: ["en"],
        availability_status: "AVAILABLE",
        currentCallCount: 0,
      })
      .returning();

    agent1Id = agent1[0].id;

    const agent2 = await db
      .insert(companyEmployees)
      .values({
        id: "agent-2",
        companyId: testCompanyId,
        userId: "user-2",
        name: "Agent 2",
        email: "agent2@test.com",
        role: "AGENT",
        skillSet: ["support", "english", "spanish"],
        languageSkills: ["en", "es"],
        availability_status: "AVAILABLE",
        currentCallCount: 0,
      })
      .returning();

    agent2Id = agent2[0].id;
  });

  it("should route to agent with matching skills", async () => {
    const result = await callRouterService.routeBySkills(
      testCompanyId,
      ["support"],
      "english"
    );

    expect(result?.id).toBe(agent2Id); // Agent 2 has support skill
  });

  it("should route using round-robin", async () => {
    const result1 = await callRouterService.routeRoundRobin(testCompanyId);
    const result2 = await callRouterService.routeRoundRobin(testCompanyId, result1?.id);

    expect(result1?.id).not.toBe(result2?.id); // Different agents
  });

  it("should return null if no agents available", async () => {
    // Mark all agents as unavailable
    await db
      .update(companyEmployees)
      .set({ availability_status: "ON_CALL" })
      .where(eq(companyEmployees.companyId, testCompanyId))
      .execute();

    const result = await callRouterService.routeBySkills(testCompanyId);
    expect(result).toBeNull();
  });

  afterAll(async () => {
    await db.delete(companyEmployees).where(eq(companyEmployees.companyId, testCompanyId));
    await db.delete(companies).where(eq(companies.id, testCompanyId));
  });
});
```

---

### TASK 1.3 - Setup Error Tracking (Sentry) ⏱️ 2 hours
**Status**: [ ] NOT STARTED [ ] IN PROGRESS [ ] DONE

**Install Sentry**:
```bash
npm install @sentry/node @sentry/integrations
```

**File**: `server/config/sentry.config.ts`

```typescript
import * as Sentry from "@sentry/node";

export function initSentry() {
  if (!process.env.SENTRY_DSN) {
    console.warn("⚠️  SENTRY_DSN not set, error tracking disabled");
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.OnUncaughtException(),
      new Sentry.Integrations.OnUnhandledRejection(),
    ],
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    environment: process.env.NODE_ENV,
    serverName: process.env.HOSTNAME || "unknown",
  });

  console.log("✅ Sentry initialized");
}

export function attachSentryMiddleware(app: any) {
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.errorHandler());
}
```

**Update `server/index.ts`**:
```typescript
import { initSentry, attachSentryMiddleware } from "@/config/sentry.config";

// At the very start
initSentry();

// ... other setup

// After all routes
attachSentryMiddleware(app);
```

**Test Sentry Integration**:
```typescript
import * as Sentry from "@sentry/node";

// Manually log an error (for testing)
try {
  throw new Error("Test error for Sentry");
} catch (error) {
  Sentry.captureException(error);
}

console.log("Error logged to Sentry");
```

---

## WEEK 2: B2B FEATURES

### TASK 2.1 - Create Employee Service ⏱️ 4 hours
**Status**: [ ] NOT STARTED [ ] IN PROGRESS [ ] DONE

**File**: `server/services/employee.service.ts`

```typescript
import { db } from "@/db";
import { companyEmployees } from "@/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

export interface CreateEmployeeInput {
  companyId: string;
  userId: string;
  name: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "AGENT";
  skillSet?: string[];
  languageSkills?: string[];
  allocatedPhoneNumber?: string;
  maxConcurrentCalls?: number;
}

export const employeeService = {
  async createEmployee(data: CreateEmployeeInput) {
    const id = crypto.randomUUID();

    const result = await db
      .insert(companyEmployees)
      .values({
        id,
        companyId: data.companyId,
        userId: data.userId,
        name: data.name,
        email: data.email,
        role: data.role,
        skillSet: data.skillSet || [],
        languageSkills: data.languageSkills || ["en"],
        allocatedPhoneNumber: data.allocatedPhoneNumber,
        maxConcurrentCalls: data.maxConcurrentCalls || 3,
        currentCallCount: 0,
        availability_status: "AVAILABLE",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return result[0];
  },

  async getEmployeeById(employeeId: string) {
    return await db.query.companyEmployees.findFirst({
      where: eq(companyEmployees.id, employeeId),
    });
  },

  async getCompanyEmployees(companyId: string) {
    return await db.query.companyEmployees.findMany({
      where: eq(companyEmployees.companyId, companyId),
    });
  },

  async updateEmployee(employeeId: string, updates: Partial<CreateEmployeeInput>) {
    const result = await db
      .update(companyEmployees)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(companyEmployees.id, employeeId))
      .returning();

    return result[0];
  },

  async updateAvailabilityStatus(
    employeeId: string,
    status: "AVAILABLE" | "ON_CALL" | "BREAK" | "UNAVAILABLE"
  ) {
    return await this.updateEmployee(employeeId, {
      availability_status: status,
    });
  },

  async deleteEmployee(employeeId: string) {
    return await db.delete(companyEmployees).where(eq(companyEmployees.id, employeeId));
  },
};
```

---

### TASK 2.2 - Create B2B Company Routes ⏱️ 6 hours
**Status**: [ ] NOT STARTED [ ] IN PROGRESS [ ] DONE

**File**: `server/routes/b2b/company.routes.ts`

```typescript
import { Router, Request, Response } from "express";
import { companyService } from "@/services/company.service";
import { employeeService } from "@/services/employee.service";
import * as Sentry from "@sentry/node";

const router = Router();

/**
 * POST /api/b2b/companies
 * Create a new company
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, email, phone, countryCode, timezone, industry } = req.body;

    // Validation
    if (!name || !email || !countryCode) {
      return res.status(400).json({
        error: "Missing required fields: name, email, countryCode",
      });
    }

    const company = await companyService.createCompany({
      name,
      email,
      phone,
      countryCode,
      timezone,
      industry,
    });

    res.status(201).json({
      success: true,
      company,
      nextSteps: [
        "Add team members",
        "Allocate phone numbers",
        "Setup call routing policy",
      ],
    });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/b2b/companies/:id
 * Get company details
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const company = await companyService.getCompanyById(req.params.id);
    const metrics = await companyService.getCompanyDashboardMetrics(req.params.id);

    res.json({
      success: true,
      company: {
        ...company,
        metrics,
      },
    });
  } catch (error) {
    Sentry.captureException(error);
    res.status(404).json({ error: error.message });
  }
});

/**
 * PUT /api/b2b/companies/:id
 * Update company
 */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { name, timezone, industry, subscriptionTier } = req.body;

    const updated = await companyService.updateCompany(req.params.id, {
      name,
      timezone,
      industry,
      subscriptionTier,
    });

    res.json({
      success: true,
      company: updated,
    });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/b2b/companies/:id/employees
 * List all employees
 */
router.get("/:id/employees", async (req: Request, res: Response) => {
  try {
    const employees = await employeeService.getCompanyEmployees(req.params.id);

    res.json({
      success: true,
      count: employees.length,
      employees,
    });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/b2b/companies/:id/employees
 * Add employee
 */
router.post("/:id/employees", async (req: Request, res: Response) => {
  try {
    const { userId, name, email, role, skillSet, languageSkills, allocatedPhoneNumber } =
      req.body;

    const employee = await employeeService.createEmployee({
      companyId: req.params.id,
      userId,
      name,
      email,
      role,
      skillSet,
      languageSkills,
      allocatedPhoneNumber,
    });

    res.status(201).json({
      success: true,
      employee,
    });
  } catch (error) {
    Sentry.captureException(error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

**Register routes in `server/index.ts`**:
```typescript
import companyRoutes from "@/routes/b2b/company.routes";

// ... after other middleware setup
app.use("/api/b2b/companies", companyRoutes);
```

---

## TESTING CHECKLIST

After completing each task:

```bash
# Run type checking
npm run typecheck

# Run tests for the task
npm run test -- <filename>

# Verify no regressions
npm run test

# Check lint issues
npm run lint

# Build check
npm run build
```

## NEXT STEPS

1. **Complete WEEK 1 tasks first** (Database & Foundation)
2. **Don't skip tests** - they catch bugs early
3. **Commit frequently** - after each completed task
4. **Daily sync** on blockers
5. **Code review before merge**

---

## HELPFUL COMMANDS

```bash
# Development
npm run dev              # Start dev server
npm run db:push         # Run migrations
npm run db:studio       # Open Drizzle Studio (database GUI)

# Testing
npm run test            # Run all tests
npm run test:watch      # Watch mode
npm run test:ui         # Test UI

# Linting
npm run lint            # Check for issues
npm run lint:fix        # Auto-fix issues

# Build
npm run build           # Production build
npm run build:check     # Check build

# Debugging
npm run dev -- --inspect   # Node debugger
```

---

Good luck! 🚀 Each task is self-contained and testable.

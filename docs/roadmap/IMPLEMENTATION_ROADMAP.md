# 📋 IMPLEMENTATION ROADMAP - 8 WEEKS TO PRODUCTION
## Week-by-Week Tasks, Code Changes, and Deliverables

**Timeline**: April-May 2026  
**Goal**: Production-ready B2B/B2C/BPO system with Excel exports, call routing, multi-language  
**Team Size**: 2-3 senior developers  

---

## ⚠️ PREREQUISITE: Fix Critical Blockers (24 hours)

**MUST DO FIRST:**
- [ ] Kill all node processes
- [ ] Restore database connectivity
- [ ] Fix frontend build
- [ ] Move secrets to AWS Secrets Manager
- [ ] Deploy fresh to staging

**Time**: 4-6 hours  
**Blocker**: Cannot proceed without this

---

## WEEK 1: Foundation & Database

### Task 1.1: Database Schema Enhancement (8 hours)
**Files to Create/Modify**:
- `server/schema/calls.schema.ts` - New call recording schema
- `server/schema/companies.schema.ts` - New company schema
- `server/schema/routing.schema.ts` - New call routing schema
- `migrations/001_add_enterprise_tables.sql`

**What to Implement**:
```sql
-- All tables from ENTERPRISE_ARCHITECTURE_V2.md
-- Tables to add:
1. companies (B2B)
2. company_employees
3. company_allocated_numbers
4. call_routing_policies
5. bpo_agents
6. call_queue
7. call_exports
8. Enhanced call_records with new fields

-- Add indexes for performance:
- call_records.company_id
- call_queue.company_id
- bpo_agents.skill_set (JSONB index)
```

**Verification**:
```bash
npm run db:push  # Drizzle migration
psql $DATABASE_URL -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';"
```

**Time**: 8 hours  
**Dependency**: Database online

---

### Task 1.2: Database Service Layer (10 hours)
**Files to Create**:
- `server/services/company.service.ts`
- `server/services/call-routing.service.ts`
- `server/services/bpo-agent.service.ts`
- `server/services/call-queue.service.ts`

**Example: company.service.ts**
```typescript
import { db } from "@/db";
import { companies } from "@/schema";

export const companyService = {
  async createCompany(data: CreateCompanyInput) {
    return db.insert(companies).values({
      id: crypto.randomUUID(),
      name: data.name,
      countryCode: data.countryCode,
      timezone: data.timezone,
      subscriptionTier: "STARTER",
      status: "ACTIVE",
      createdAt: new Date(),
    }).returning();
  },

  async getCompanyById(id: string) {
    return db.query.companies.findFirst({
      where: (t) => eq(t.id, id),
    });
  },

  async updateCompanyRoutingPolicy(companyId: string, policyData: any) {
    // Logic for updating how calls are routed for company
  },

  async getCompanyDashboardMetrics(companyId: string) {
    // Return: calls today, avg duration, revenue, customer satisfaction
  },
};
```

**Time**: 10 hours  
**Dependency**: Complete 1.1

---

### Task 1.3: Setup Error Tracking & Monitoring (4 hours)
**Files to Create/Modify**:
- `server/config/sentry.config.ts`
- `server/middleware/error-handler.middleware.ts`
- Update `server/index.ts`

**What to Implement**:
```typescript
// server/config/sentry.config.ts
import * as Sentry from "@sentry/node";

export function initSentry() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.OnUncaughtException(),
    ],
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    environment: process.env.NODE_ENV,
  });
}

// Add to middleware
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());
```

**Time**: 4 hours  
**Cost**: $0-25/month (Sentry free tier)

---

### Week 1 Deliverables
- ✅ Database with all enterprise tables
- ✅ Service layer for companies, routing, BPO
- ✅ Error tracking configured
- ✅ Schema migrations tested
- ✅ All tests passing

**Time**: 22 hours ≈ **1 week (with testing)**

---

## WEEK 2: B2B Core Features

### Task 2.1: Company Management API (10 hours)
**Files to Create**:
- `server/routes/b2b/company.routes.ts`
- `server/controllers/company.controller.ts`

**Endpoints to Implement**:
```
POST   /api/b2b/companies
       - Create company (with subscription tier)

GET    /api/b2b/companies/:id
       - Get company details + dashboard metrics

PUT    /api/b2b/companies/:id
       - Update company settings

GET    /api/b2b/companies/:id/employees
       - List all employees

POST   /api/b2b/companies/:id/employees
       - Add team member

PUT    /api/b2b/companies/:id/routing-policy
       - Update call routing logic

GET    /api/b2b/companies/:id/metrics
       - Dashboard: calls, revenue, SLA, customer satisfaction
```

**Example Endpoint**:
```typescript
// POST /api/b2b/companies
export async function createCompany(req: Request, res: Response) {
  const { name, countryCode, timezone, industry, employeeCount } = req.body;

  try {
    const company = await companyService.createCompany({
      name,
      countryCode,
      timezone,
      industry,
      employeeCount,
    });

    res.json({
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
    res.status(400).json({ error: error.message });
  }
}
```

**Time**: 10 hours

---

### Task 2.2: Employee Management (8 hours)
**Files to Create**:
- `server/routes/b2b/employee.routes.ts`
- `server/services/employee.service.ts`

**Features**:
- Add/remove employees
- Assign roles (ADMIN, MANAGER, AGENT)
- Set language skills (["en", "te", "hi"])
- Assign phone numbers to agents
- Set max concurrent calls

**Time**: 8 hours

---

### Task 2.3: Call Routing Engine (12 hours)
**Files to Create**:
- `server/services/call-router.service.ts`
- `server/services/routing-policy.service.ts`

**Routing Modes to Implement**:
```typescript
enum RoutingMode {
  ROUND_ROBIN = "round-robin",
  SKILL_BASED = "skill-based",
  PRIORITY = "priority",
  LOAD_BALANCED = "load-balanced",
  TIME_ZONES = "time-zones",
}

// Example: Skill-based routing
async function routeCallBySkills(
  companyId: string,
  requiredSkills: string[],
  preferredLanguage: string
) {
  // 1. Get all company employees
  // 2. Filter by skills match
  // 3. Filter by language capability
  // 4. Filter by availability
  // 5. Return best match

  const employees = await getCompanyEmployees(companyId);
  
  const qualified = employees.filter((emp) => {
    const hasSkills = requiredSkills.every((s) =>
      emp.skillSet.includes(s)
    );
    const hasLanguage = emp.languageSkills.includes(preferredLanguage);
    const isAvailable = emp.currentCallCount < emp.maxConcurrentCalls;
    
    return hasSkills && hasLanguage && isAvailable;
  });

  // Sort by: least busy + best customer satisfaction
  return qualified.sort(
    (a, b) => a.currentCallCount - b.currentCallCount
  )[0];
}
```

**Time**: 12 hours

---

### Week 2 Deliverables
- ✅ B2B company management API
- ✅ Employee management (CRUD)
- ✅ Call routing engine (5 modes)
- ✅ All endpoints tested
- ✅ Postman collection provided

**Time**: 30 hours ≈ **1 week**

---

## WEEK 3: BPO Integration & Call Queue

### Task 3.1: BPO Agent System (8 hours)
**Files to Create**:
- `server/services/bpo-agent.service.ts`
- `server/routes/bpo/agent.routes.ts`

**Features**:
- Register BPO agents
- Track availability status
- Skills management
- Performance metrics

**Example**:
```typescript
export const bpoAgentService = {
  async registerAgent(data: {
    companyId: string;
    userId: string;
    skills: string[];
    languages: string[];
  }) {
    return db.insert(bpoAgents).values({
      id: crypto.randomUUID(),
      companyId: data.companyId,
      userId: data.userId,
      skillSet: data.skills,
      languageSkills: data.languages,
      availability_status: "AVAILABLE",
      createdAt: new Date(),
    });
  },

  async updateAgentStatus(agentId: string, status: string) {
    return db.update(bpoAgents)
      .set({ availability_status: status })
      .where(eq(bpoAgents.id, agentId));
  },
};
```

**Time**: 8 hours

---

### Task 3.2: Call Queue & Queue Management (10 hours)
**Files to Create**:
- `server/services/call-queue.service.ts`
- `server/controllers/queue.controller.ts`

**Features**:
```typescript
export const callQueueService = {
  async addCallToQueue(data: {
    companyId: string;
    incomingCallId: string;
    callerPhone: string;
    callerName?: string;
    requiredSkills?: string[];
    preferredLanguage?: string;
  }) {
    // 1. Find best agent or add to queue
    // 2. If agent available: assign immediately
    // 3. If not: add to queue with position
    // 4. Return queue position and estimated wait

    const availableAgent = await findAvailableAgent(
      data.companyId,
      data.requiredSkills,
      data.preferredLanguage
    );

    if (availableAgent) {
      // Immediate assignment
      await assignCallToAgent(availableAgent.id, data.incomingCallId);
      return { status: "ASSIGNED", agentId: availableAgent.id };
    } else {
      // Queue the call
      const queuePosition = await db.insert(callQueue).values({
        id: crypto.randomUUID(),
        companyId: data.companyId,
        incomingCallId: data.incomingCallId,
        callerPhone: data.callerPhone,
        queue_position: await getQueueLength(data.companyId) + 1,
        required_skills: data.requiredSkills,
        required_languages: [data.preferredLanguage],
        status: "WAITING",
        createdAt: new Date(),
      });

      return {
        status: "QUEUED",
        position: queuePosition[0].queue_position,
        estimatedWait: calculateWaitTime(queuePosition[0].queue_position),
      };
    }
  },

  async assignCallToAgent(agentId: string, callId: string) {
    // 1. Update call_queue record
    // 2. Update agent status to ON_CALL
    // 3. Notify agent through WebSocket
    // 4. Return connection details
  },

  async completeCall(callId: string, durationSeconds: number) {
    // 1. Update call_records with duration
    // 2. Update agent metrics
    // 3. Check if agents are available to take next queued call
    // 4. Auto-assign if available
  },
};
```

**Time**: 10 hours

---

### Task 3.3: IVR (Interactive Voice Response) System (6 hours)
**Files to Create**:
- `server/services/ivr.service.ts`

**Features**:
```typescript
// Simple IVR menu
export const ivrService = {
  async playWelcome(companyId: string) {
    return text2Speech(
      `Welcome to ${companyName}. Press 1 for Sales, 2 for Support, 3 for Billing`
    );
  },

  async captureDigits(expectedDigits: number) {
    // Listen for DTMF tones (phone key presses)
    // Return pressed digits
  },

  async routeBySelection(selection: string, companyId: string) {
    const routeMap = {
      "1": { skill: "sales", department: "sales" },
      "2": { skill: "support", department: "support" },
      "3": { skill: "billing", department: "billing" },
    };

    return routeMap[selection] || { skill: "general", department: "general" };
  },
};
```

**Time**: 6 hours

---

### Week 3 Deliverables
- ✅ BPO agent management system
- ✅ Call queue with intelligent routing
- ✅ Basic IVR (Interactive Voice Response)
- ✅ Queue monitoring dashboard
- ✅ Agent status updates real-time

**Time**: 24 hours ≈ **1 week**

---

## WEEK 4: Language Bridge & Translation

### Task 4.1: Real-Time Translation Engine (12 hours)
**Files to Create**:
- `server/services/translation.service.ts`
- `client/hooks/use-translation.ts`

**Features**:
```typescript
// server/services/translation.service.ts
export const translationService = {
  async translateText(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    options?: { preserveEmotion: boolean; detectSentiment: boolean }
  ) {
    // 1. Detect if translation needed
    if (sourceLanguage === targetLanguage) return { translatedText: text };

    // 2. Use OpenAI with fine-tuned model for accuracy
    const response = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Translate the following ${sourceLanguage} text to ${targetLanguage}. 
                   Return ONLY the translated text, no explanations.
                   ${options?.preserveEmotion ? "Preserve emotion and tone." : ""}
                   ${options?.detectSentiment ? "Also detect sentiment (positive/negative/neutral)." : ""}`,
        },
        { role: "user", content: text },
      ],
      temperature: 0.3, // Low temperature for consistency
    });

    return {
      translatedText: response.choices[0].message.content,
      sourceLanguage,
      targetLanguage,
    };
  },

  async detectLanguage(text: string) {
    // Use Deepgram or simple detection
    const detected = await deepgram.detectLanguage(text);
    return detected.language;
  },

  async translateSpeech(
    audioBuffer: Buffer,
    sourceLanguage: string,
    targetLanguage: string
  ) {
    // 1. Speech-to-text (Deepgram)
    const transcript = await deepgram.transcribe(audioBuffer, {
      language: sourceLanguage,
    });

    // 2. Translate text
    const translation = await this.translateText(
      transcript.results.channels[0].alternatives[0].transcript,
      sourceLanguage,
      targetLanguage,
      { preserveEmotion: true }
    );

    // 3. Text-to-speech (ElevenLabs)
    const audio = await elevenLabs.textToSpeech(translation.translatedText, {
      language: targetLanguage,
      voice: "professional",
    });

    return {
      originalText: transcript.results.channels[0].alternatives[0].transcript,
      translatedText: translation.translatedText,
      audioBuffer: audio.buffer,
    };
  },
};
```

**Supported Languages** (15):
- English, Spanish, French, German
- Hindi, Telugu, Tamil, Kannada, Malayalam
- Chinese (Simplified & Traditional), Japanese
- Portuguese, Italian, Russian

**Time**: 12 hours

---

### Task 4.2: Emotion & Sentiment Detection (8 hours)
**Files to Create**:
- `server/services/emotion.service.ts`
- `server/services/sentiment.service.ts`

**Features**:
```typescript
export const emotionService = {
  async detectEmotion(audioBuffer: Buffer) {
    // Use Hume AI or Azure Emotional Analysis
    const response = await humeApi.detectEmotion(audioBuffer);
    
    return {
      emotion: response.emotion, // HAPPY, SAD, ANGRY, FRUSTRATED, NEUTRAL
      confidence: response.confidence,
      recommendations: generateEmpathicResponse(response.emotion),
    };
  },
};

export const sentimentService = {
  async analyzeSentiment(text: string) {
    const response = await huggingface.textClassification(text, {
      model: "distilbert-base-uncased-finetuned-sst-2-english",
    });

    return {
      sentiment: response[0].label, // POSITIVE, NEGATIVE
      score: response[0].score,
    };
  },
};
```

**Time**: 8 hours

---

### Task 4.3: Call Transcript & Summary Generation (6 hours)
**Files to Create**:
- `server/services/transcript.service.ts`

**Features**:
```typescript
export const transcriptService = {
  async generateTranscript(callId: string) {
    // Get call recording
    const callRecord = await getCallRecord(callId);

    // 1. Extract both speakers' audio
    // 2. Transcribe each separately
    // 3. Align with timestamps
    // 4. Generate formatted transcript

    const transcript = await constructTranscript(
      callRecord.recordingUrl,
      callRecord.sourceLanguage,
      callRecord.targetLanguage
    );

    // 5. Generate summary using GPT-4
    const summary = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "Summarize this call transcript in 2-3 sentences.",
        },
        { role: "user", content: transcript },
      ],
    });

    return {
      transcript,
      summary: summary.choices[0].message.content,
      language: callRecord.sourceLanguage,
    };
  },
};
```

**Time**: 6 hours

---

### Week 4 Deliverables
- ✅ Real-time translation (15 languages)
- ✅ Emotion detection
- ✅ Sentiment analysis
- ✅ Transcript generation
- ✅ Call summaries (AI-powered)

**Time**: 26 hours ≈ **1 week**

---

## WEEK 5: Excel Exports & Analytics Dashboard

### Task 5.1: Excel Export Engine (10 hours)
**Files to Create**:
- `server/services/excel-export.service.ts`
- `server/routes/exports.routes.ts`

**Features**:
```typescript
import ExcelJS from 'exceljs';

export const excelExportService = {
  async exportCallHistory(
    userId: string,
    companyId?: string,
    dateRange?: { start: Date; end: Date }
  ) {
    // 1. Query call records
    const calls = await queryCallRecords({
      userId,
      companyId,
      startDate: dateRange?.start,
      endDate: dateRange?.end,
    });

    // 2. Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Call History");

    // 3. Add headers
    worksheet.columns = [
      { header: "Call ID", key: "id", width: 15 },
      { header: "Date", key: "startTime", width: 20 },
      { header: "Duration (min)", key: "durationSeconds", width: 15 },
      { header: "Contact/Company", key: "otherParty", width: 20 },
      { header: "Language", key: "language", width: 15 },
      { header: "Type", key: "callType", width: 15 },
      { header: "Status", key: "status", width: 15 },
      { header: "Quality", key: "quality", width: 10 },
      { header: "Cost", key: "cost", width: 10 },
      { header: "Notes", key: "notes", width: 30 },
    ];

    // 4. Add data rows
    calls.forEach((call) => {
      worksheet.addRow({
        id: call.id,
        startTime: call.startTime.toLocaleString(),
        durationSeconds: Math.round(call.durationSeconds / 60),
        otherParty: call.receiverName,
        language: call.targetLanguage,
        callType: call.callType,
        status: call.status,
        quality: call.callQualityScore,
        cost: call.cost,
        notes: call.notes,
      });
    });

    // 5. Add formatting
    worksheet.getRow(1).font = { bold: true, bg: "CCCCCC" };
    worksheet.getColumn("startTime").numFmt = "yyyy-mm-dd hh:mm:ss";

    // 6. Add summary sheet (if company)
    if (companyId) {
      const summarySheet = workbook.addWorksheet("Summary");
      const metrics = await getCompanyMetrics(companyId, dateRange);

      summarySheet.addRow(["Total Calls", metrics.totalCalls]);
      summarySheet.addRow(["Total Duration (hours)", metrics.totalDurationHours]);
      summarySheet.addRow(["Avg Duration (min)", metrics.avgDuration]);
      summarySheet.addRow(["Total Revenue", `$${metrics.totalRevenue}`]);
      summarySheet.addRow(["Customer Satisfaction", `${metrics.satisfaction}%`]);
    }

    // 7. Save & return
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  },

  async exportCompanyAnalytics(companyId: string, period: string) {
    // Similar to above but with company-specific metrics
    // Includes: agent performance, queue metrics, SLA compliance, etc.
  },

  async exportBPOMetrics(bpoCompanyId: string, dateRange: { start; end }) {
    // BPO-specific: agent productivity, call quality, customer satisfaction
  },
};
```

**API Endpoint**:
```
GET /api/exports/call-history
GET /api/exports/company-analytics?companyId=X&period=monthly
GET /api/exports/bpo-metrics?bpoId=X&format=excel|csv|pdf
```

**Time**: 10 hours

---

### Task 5.2: Analytics Dashboard (12 hours)
**Files to Create**:
- `client/pages/analytics/Dashboard.tsx`
- `client/components/charts/CallMetrics.tsx`
- `client/components/charts/RevenueChart.tsx`
- `server/routes/analytics.routes.ts`

**Dashboard Features**:
```typescript
// User Dashboard
{
  callsToday: 5,
  totalContacts: 23,
  totalMinutesSpent: 127,
  recentContacts: [...],
  chartData: { /* calls by hour */ }
}

// Company Dashboard
{
  teamMetrics: {
    agentsOnline: 3,
    callsInQueue: 5,
    avgWaitTime: "2m 30s",
    satisfaction: 4.5,
  },
  revenueMetrics: {
    todayRevenue: "$1,240",
    monthlyRevenue: "$12,500",
    revenuePerCall: "$15",
  },
  operationalMetrics: {
    slaCompliance: "96%",
    abandonmentRate: "2%",
    avgCallDuration: "3m 45s",
  },
  charts: [
    "calls by hour",
    "calls by agent",
    "calls by customer",
    "revenue trend",
    "satisfaction trend"
  ]
}
```

**Time**: 12 hours

---

### Task 5.3: Custom Reports (6 hours)
**Features**:
- Date range selection
- Filter by agent, customer, skill
- Select metrics to include
- Schedule recurring email reports
- Share reports with team

**Time**: 6 hours

---

### Week 5 Deliverables
- ✅ Excel export (calls, analytics, BPO)
- ✅ Analytics dashboard (3 types)
- ✅ Custom report builder
- ✅ Real-time metrics
- ✅ Email scheduling

**Time**: 28 hours ≈ **1 week**

---

## WEEK 6: Security Hardening & Compliance

### Task 6.1: End-to-End Encryption (8 hours)
**Files**:
- `server/services/encryption.service.ts`

**Implementation**:
```typescript
import crypto from "crypto";

export const encryptionService = {
  // Encrypt sensitive data at rest
  encryptData(plaintext: string, key?: string): string {
    const enckey = key || process.env.ENCRYPTION_KEY;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(enckey, "hex"), iv);

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
  },

  decryptData(ciphertext: string, key?: string): string {
    const enckey = key || process.env.ENCRYPTION_KEY;
    const parts = ciphertext.split(":");
    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(enckey, "hex"), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(parts[2], "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  },

  // TLS 1.3 for all communication (setup in server config)
  // WebRTC SRTP for call encryption (handled by WebRTC)
};
```

**Time**: 8 hours

---

### Task 6.2: GDPR Compliance (6 hours)
**Features**:
- Data deletion endpoint (cascade delete all user data)
- Data export endpoint (ZIP with all user data as JSON)
- Consent management
- Privacy policy enforcement
- Cookie consent banner

**Endpoints**:
```
DELETE /api/gdpr/my-data
  → Permanently delete all user data
  → Requires password confirmation
  → Soft-delete with 30-day recovery window

GET /api/gdpr/export
  → Download all user data as JSON/ZIP
  → Includes: profile, contacts, call history, preferences

POST /api/gdpr/consent
  → Track consent for marketing, analytics, etc.
```

**Time**: 6 hours

---

### Task 6.3: Rate Limiting & DDoS Protection (6 hours)
**Middleware**:
```typescript
import rateLimit from "express-rate-limit";

// General API limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: "Too many requests, please try again later",
});

// Strict limiter for sensitive endpoints
const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute
});

// Apply to routes
app.use("/api/", apiLimiter);
app.post("/api/auth/login", strictLimiter, loginHandler);
app.post("/api/payment/", strictLimiter, paymentHandler);
```

**Time**: 6 hours

---

### Week 6 Deliverables
- ✅ End-to-end encryption (calls)
- ✅ Data encryption at rest (AES-256)
- ✅ GDPR compliance (deletion, export)
- ✅ Rate limiting
- ✅ Privacy policy enforcement

**Time**: 18 hours ≈ **0.5 week**

---

## WEEK 7: Testing & Deployment

### Task 7.1: Unit & Integration Tests (12 hours)
**Critical Paths to Test**:
- Company creation & employee management
- Call routing (all 5 modes)
- Call queue logic
- Excel export functionality
- Translation accuracy
- BPO agent assignment

**Example Test**:
```typescript
// tests/services/call-router.test.ts
describe("Call Router Service", () => {
  it("should route call to agent with matching skills", async () => {
    const company = await createTestCompany();
    const agent1 = await createTestAgent(company.id, {
      skills: ["sales", "english"],
    });
    const agent2 = await createTestAgent(company.id, {
      skills: ["support", "spanish"],
    });

    const result = await callRouterService.routeBySkills(
      company.id,
      ["sales"],
      "english"
    );

    expect(result.id).toBe(agent1.id);
  });

  it("should queue call if no agents available", async () => {
    // ... test queuing logic
  });
});
```

**Time**: 12 hours

---

### Task 7.2: Load Testing & Performance (8 hours)
**Tools**: k6, Artillery, or JMeter

**Test Scenarios**:
- 100 concurrent calls
- 10 agents handling calls
- Database queries under load
- Translation API response time
- Excel export with 10k records

**Time**: 8 hours

---

### Task 7.3: Deployment & Infrastructure (10 hours)
**Setup**:
- Docker containers
- Kubernetes manifests
- Environment configs (.env.prod)
- Database backups
- Monitoring dashboards (Prometheus + Grafana)

**Time**: 10 hours

---

### Week 7 Deliverables
- ✅ 80%+ test coverage for critical paths
- ✅ Load tests passed (10k concurrent)
- ✅ Docker + K8s ready
- ✅ Monitoring configured
- ✅ Ready for staging deployment

**Time**: 30 hours ≈ **1 week**

---

## WEEK 8: final Polish & Production Launch

### Task 8.1: UI/UX Polish (6 hours)
- Dark mode support
- Mobile responsiveness
- Accessibility (WCAG 2.1)
- Onboarding flows
- Error messages (user-friendly)

**Time**: 6 hours

---

### Task 8.2: Documentation (8 hours)
- API documentation (Swagger/OpenAPI)
- User guides (B2C, B2B, BPO)
- Developer documentation
- Deployment runbook
- Troubleshooting guide

**Time**: 8 hours

---

### Task 8.3: Staging → Production Migration (8 hours)
- Data migration from staging
- SSL certificate setup
- Domain configuration
- Monitoring alerts configured
- SLA contracts ready

**Time**: 8 hours

---

### Week 8 Deliverables
- ✅ Production-ready system
- ✅ All documentation complete
- ✅ Team trained
- ✅ Support procedures defined
- ✅ Launch communication prepared

**Time**: 22 hours ≈ **0.5 week**

---

## 📊 TOTAL EFFORT

| Week | Focus | Hours | Status |
|------|-------|-------|--------|
| 1 | Database & Foundation | 22 | |
| 2 | B2B Core | 30 | |
| 3 | BPO Integration | 24 | |
| 4 | Language Bridge | 26 | |
| 5 | Excel & Analytics | 28 | |
| 6 | Security | 18 | |
| 7 | Testing & Deployment | 30 | |
| 8 | Polish & Launch | 22 | |
| **TOTAL** | **8 weeks** | **200 hours** | **≈ 5 weeks with 2-3 devs** |

---

## 👥 TEAM REQUIREMENTS

**Minimum**: 2 senior fullstack developers  
**Better**: 2 backend + 1 frontend + 1 DevOps  
**Weekly standup**: 30 min (blockers, progress)  
**Code review required**: All PRs reviewed before merge

---

## ✅ LAUNCH CRITERIA

- [ ] All unit tests passing (80%+ coverage)
- [ ] Load test passed (10k concurrent without errors)
- [ ] Zero security vulnerabilities (Snyk scan)
- [ ] Documentation complete
- [ ] Team trained
- [ ] Support team ready (handles calls 24/7)
- [ ] Monitoring & alerting configured
- [ ] Backup & recovery tested (and works!)
- [ ] Legal review completed (privacy, ToS, compliance)
- [ ] CEO sign-off for production

---

## 🚀 LAUNCH DAY

```
5:00 AM - Final backup
5:30 AM - Deploy to production (during low-traffic window)
6:00 AM - Smoke tests (verify all systems)
6:30 AM - Enable monitoring alerts
7:00 AM - Team on standby
8:00 AM - Open for beta users (100 max)
12:00 PM - Expand to 500 users
4:00 PM - Full launch
```

---

## 📞 POST-LAUNCH SUPPORT

**First Week**:
- Monitor errors 24/7
- Response time: <30 min for critical issues
- Daily sync with users
- Patch bugs immediately

**Month 1**:
- Gather feedback
- Iterate on UX
- Optimize database queries
- Document lessons learned

---

**This is your roadmap to $100k+/month SaaS.** Follow it. You'll succeed.

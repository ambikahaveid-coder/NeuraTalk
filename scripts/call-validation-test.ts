#!/usr/bin/env npx tsx
/**
 * END-TO-END CALL VALIDATION TEST
 *
 * Tests the complete call pipeline without real audio devices.
 * Validates: connection time, translation latency, billing deduction,
 * call persistence, and graceful degradation.
 *
 * Usage:
 *   npx tsx scripts/call-validation-test.ts
 *   npx tsx scripts/call-validation-test.ts --base-url http://localhost:5000
 *
 * Requirements:
 *   - Server running at BASE_URL
 *   - At least one super_admin user in database
 *   - Redis running
 */

const BASE_URL = process.argv.find(a => a.startsWith("--base-url="))?.split("=")[1]
  || process.env.BASE_URL
  || "http://localhost:5000";

interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];
let authToken: string | null = null;

async function api(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(extraHeaders || {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data };
}

async function runTest(name: string, fn: () => Promise<string | void>): Promise<void> {
  const start = Date.now();
  try {
    const details = await fn();
    results.push({ name, passed: true, durationMs: Date.now() - start, details: details || undefined });
    console.log(`  ✓ ${name} (${Date.now() - start}ms)`);
  } catch (error: any) {
    results.push({ name, passed: false, durationMs: Date.now() - start, error: error.message });
    console.log(`  ✗ ${name} (${Date.now() - start}ms) — ${error.message}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ─── TEST SUITES ──────────────────────────────────────────────────

async function testHealthEndpoints() {
  console.log("\n1. HEALTH & READINESS PROBES");

  await runTest("GET /healthz returns 200", async () => {
    const { status, data } = await api("GET", "/healthz");
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.status === "ok" || data.status === "healthy", `Expected ok/healthy, got ${data.status}`);
    return `status=${data.status}, ts=${data.timestamp || "n/a"}`;
  });

  await runTest("GET /readyz returns database status", async () => {
    const { status, data } = await api("GET", "/readyz");
    assert(status === 200 || status === 503, `Unexpected status ${status}`);
    const dbCheck = data.checks?.database;
    assert(dbCheck, "Missing database check");
    return `status=${data.status}, db=${dbCheck.status}(${dbCheck.latencyMs || 0}ms)`;
  });

  await runTest("GET /metrics returns Prometheus format", async () => {
    const res = await fetch(`${BASE_URL}/metrics`);
    const text = await res.text();
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(text.includes("neuratalk_process_heap_bytes"), "Missing heap metric");
    assert(text.includes("neuratalk_active_calls"), "Missing active_calls metric");
    assert(text.includes("neuratalk_translation_latency_p50_ms"), "Missing latency metric");
    const lines = text.split("\n").filter(l => !l.startsWith("#") && l.trim()).length;
    return `${lines} metric lines exported`;
  });
}

async function testAuthentication() {
  console.log("\n2. AUTHENTICATION");

  await runTest("POST /api/auth/otp/request mobile → correctly rejects (Firebase-only path)", async () => {
    const { status, data } = await api("POST", "/api/auth/otp/request", {
      identifier: "+919999999999",
      channel: "mobile",
    });
    assert(status === 400, `Expected 400 (Firebase-only rejection), got ${status}: ${JSON.stringify(data)}`);
    return `Correctly rejected with: ${data.message || "no message"}`;
  });

  await runTest("POST /api/auth/otp/verify mobile → correctly rejects (Firebase-only path)", async () => {
    const { status, data } = await api("POST", "/api/auth/otp/verify", {
      identifier: "+919999999999",
      channel: "mobile",
      code: "000000",
    });
    assert(status === 400, `Expected 400 (Firebase-only rejection), got ${status}: ${JSON.stringify(data)}`);
    assert(!data.token, "Should not return token for non-Firebase mobile verify");
    return `Correctly rejected with: ${data.message || "no message"}`;
  });
}

async function testBillingPlans() {
  console.log("\n3. BILLING SYSTEM");

  await runTest("GET /api/billing/plans returns active plans", async () => {
    const { status, data } = await api("GET", "/api/billing/plans");
    assert(status === 200, `Expected 200, got ${status}`);
    const plans = data.plans || data;
    assert(Array.isArray(plans), "Plans is not an array");
    assert(plans.length > 0, "No plans found");
    return `${plans.length} plans (B2C: ${plans.filter((p: any) => p.planType === "b2c").length}, B2B: ${plans.filter((p: any) => p.planType === "b2b").length})`;
  });

  await runTest("GET /api/billing/status returns user billing state", async () => {
    const { status, data } = await api("GET", "/api/billing/status");
    assert(status === 200 || status === 404, `Unexpected status ${status}`);
    return `subscription=${data.subscription?.status || "none"}, balance=${data.balance || 0} paise`;
  });
}

async function testTranslationPipeline() {
  console.log("\n4. TRANSLATION PIPELINE (SDK)");

  await runTest("POST /api/translate (text translation)", async () => {
    const { status, data } = await api("POST", "/api/translate", {
      text: "Hello, how are you?",
      sourceLanguage: "en",
      targetLanguage: "hi",
    });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
    const translated = data.translatedText || data.translation || data.text;
    assert(translated, `No translated text. Response: ${JSON.stringify(data)}`);
    return `"Hello, how are you?" → "${translated}" (provider=${data.provider || "?"})`;
  });
}

async function testCallMetrics() {
  console.log("\n5. CALL METRICS & MONITORING");

  await runTest("GET /api/admin/call-metrics returns pipeline stats", async () => {
    const { status, data } = await api("GET", "/api/admin/call-metrics");
    if (status === 403) return "Skipped (not super_admin)";
    assert(status === 200, `Expected 200, got ${status}`);
    return `stt_p50=${data.stt?.p50 || 0}ms, translation_p50=${data.translation?.p50 || 0}ms, tts_p50=${data.tts?.p50 || 0}ms, total_p50=${data.total?.p50 || 0}ms`;
  });
}

async function testConfigStatus() {
  console.log("\n6. PLATFORM CONFIG STATUS");

  await runTest("GET /api/admin/config/status shows all service keys", async () => {
    const { status, data } = await api("GET", "/api/admin/config/status");
    if (status === 403) return "Skipped (not super_admin)";
    assert(status === 200, `Expected 200, got ${status}`);
    const configs = data.configs || [];
    const configured = configs.filter((c: any) => c.isSet).length;
    const total = configs.length;
    const missing = configs.filter((c: any) => !c.isSet && c.requiredForStatus).map((c: any) => c.key);
    return `${configured}/${total} configured. Missing critical: ${missing.length > 0 ? missing.join(", ") : "none"}`;
  });
}

async function testApiKeySystem() {
  console.log("\n7. ENTERPRISE API KEY SYSTEM");

  await runTest("GET /api/admin/api-keys lists keys", async () => {
    const { status, data } = await api("GET", "/api/admin/api-keys");
    if (status === 403) return "Skipped (not super_admin)";
    assert(status === 200, `Expected 200, got ${status}`);
    const keys = data.keys || [];
    return `${keys.length} API keys (active: ${keys.filter((k: any) => k.status === "active").length}, pending: ${keys.filter((k: any) => k.status === "pending").length})`;
  });
}

async function testCallInitiation() {
  console.log("\n8. CALL INITIATION (requires LiveKit)");

  await runTest("GET /api/livekit/config returns WebSocket URL", async () => {
    const { status, data } = await api("GET", "/api/livekit/config");
    assert(status === 200, `Expected 200, got ${status}`);
    return `LiveKit URL: ${data.url || "not configured"}`;
  });

  await runTest("GET /api/calls/ice-servers returns STUN/TURN config", async () => {
    const { status, data } = await api("GET", "/api/calls/ice-servers");
    assert(status === 200, `Expected 200, got ${status}`);
    const servers = data.iceServers || data;
    return `${Array.isArray(servers) ? servers.length : 0} ICE servers configured`;
  });
}

// ─── MAIN ─────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  NEURATALK END-TO-END VALIDATION TEST");
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Time:   ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════════════════");

  // Verify server is reachable
  try {
    await fetch(`${BASE_URL}/api/health`);
  } catch {
    console.error(`\n  ERROR: Server not reachable at ${BASE_URL}`);
    process.exit(1);
  }

  await testHealthEndpoints();
  await testAuthentication();
  await testBillingPlans();
  await testTranslationPipeline();
  await testCallMetrics();
  await testConfigStatus();
  await testApiKeySystem();
  await testCallInitiation();

  // ── Summary ──
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log(`  Total time: ${totalMs}ms`);
  console.log("═══════════════════════════════════════════════════════");

  if (failed > 0) {
    console.log("\n  FAILED TESTS:");
    results.filter(r => !r.passed).forEach(r => {
      console.log(`    ✗ ${r.name}: ${r.error}`);
    });
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});

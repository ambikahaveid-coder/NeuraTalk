/**
 * Neura-Talk FINAL PRODUCTION AUDIT
 * Perspective: Senior Architect & Tester
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

console.log("Starting Final Production Readiness Audit...");

function runCommand(command) {
  execSync(command, {
    stdio: "inherit",
    cwd: repoRoot,
  });
}

function ensureFileExists(relativePath) {
  const fullPath = path.resolve(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
}

function ensureFileContains(relativePath, snippet) {
  const fullPath = path.resolve(repoRoot, relativePath);
  const content = fs.readFileSync(fullPath, "utf8");
  if (!content.includes(snippet)) {
    throw new Error(`Expected to find "${snippet}" in ${relativePath}`);
  }
}

function ensureEnvTemplateMatch() {
  const examplePath = path.resolve(repoRoot, ".env.example");
  const envPath = path.resolve(repoRoot, ".env");

  ensureFileExists(".env.example");
  ensureFileExists(".env");

  const exampleContent = fs.readFileSync(examplePath, "utf8");
  const envContent = fs.readFileSync(envPath, "utf8");

  const requiredKeys = exampleContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.split("=")[0]?.trim())
    .filter(Boolean);

  const missingKeys = requiredKeys.filter((key) => !envContent.includes(`${key}=`));
  if (missingKeys.length > 0) {
    throw new Error(`Missing keys in .env: ${missingKeys.join(", ")}`);
  }
}

const checks = [
  { name: "Syntax Verification", run: () => runCommand("npm run check") },
  { name: "Frontend Build", run: () => runCommand("npm run build") },
  { name: "Security Scan", run: () => runCommand("node scripts/security-audit.js") },
  { name: "Database Integrity", run: () => runCommand("node scripts/db-post-validate.mjs") },
  { name: "Legal Compliance Check", run: () => ensureFileExists("LEGAL_PRODUCTION_DOCUMENTS.md") },
  { name: "Mobile Bridge Verify", run: () => ensureFileContains("server/production-routes.ts", "/api/push/register") },
  { name: "Env Template Match", run: ensureEnvTemplateMatch },
];

let failed = false;

for (const check of checks) {
  try {
    console.log(`Checking: ${check.name}...`);
    check.run();
    console.log(`${check.name} passed.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${check.name} FAILED: ${message}`);
    failed = true;
  }
}

if (failed) {
  console.error("\nApplication not ready. Fix the errors above before building.");
  process.exit(1);
}

console.log("\nNeura-Talk production readiness audit passed.");

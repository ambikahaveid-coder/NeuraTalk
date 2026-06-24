/**
 * Neura-Talk Security Shield
 * Prevents commits/deploys if real secrets are found in plaintext.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sensitivePatterns = [
  /sk-[a-zA-Z0-9]{20,}/,
  /AC[a-z0-9]{32}/,
  /postgresql:\/\/[^:]+:[^@]+@/,
  /rzp_(?:test|live)_[a-zA-Z0-9]{14}/,
  /AIza[0-9A-Za-z-_]{35}/,
  /-----BEGIN PRIVATE KEY-----/,
];

console.log("Running Senior Dev Security Audit...");

const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  const leaks = sensitivePatterns.filter((pattern) => pattern.test(content));

  if (leaks.length > 0 || content.includes("sk-proj-") || content.includes("npg_")) {
    console.error("CRITICAL SECURITY RISK: Real API keys or passwords detected in .env.");
    console.error("Action Required: Rotate leaked keys and move them to a secure vault.");
    console.error("Do NOT commit this .env file.");
    process.exit(1);
  }
}

console.log("Security audit passed.");

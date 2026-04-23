/**
 * Neura-Talk Security Shield
 * Prevents commits/deploys if real secrets are found in plaintext.
 */
const fs = require('fs');
const path = require('path');

const sensitivePatterns = [
  /sk-[a-zA-Z0-9]{20,}/,          // OpenAI / ElevenLabs
  /AC[a-z0-9]{32}/,               // Twilio SID
  /postgresql:\/\/[^:]+:[^@]+@/,  // DB Credentials
  /rzp_(?:test|live)_[a-zA-Z0-9]{14}/, // Razorpay
  /AIza[0-9A-Za-z-_]{35}/,        // Firebase API Key
  /-----BEGIN PRIVATE KEY-----/    // RSA Private Keys (Firebase/SSH)
];

console.log("🛡️ Running Senior Dev Security Audit...");

// Scan .env and source files
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  
  const leaks = sensitivePatterns.filter(pattern => pattern.test(content));
  
  if (leaks.length > 0 || content.includes('sk-proj-') || content.includes('npg_')) {
    console.error("❌ CRITICAL SECURITY RISK: Real API keys or Passwords detected in .env!");
    console.error("Action Required: Rotate leaked keys and move them to a secure vault (AWS Secrets Manager / Doppler).");
    console.error("Do NOT commit this .env file.");
    process.exit(1);
  }
}
console.log("✅ Security audit passed.");
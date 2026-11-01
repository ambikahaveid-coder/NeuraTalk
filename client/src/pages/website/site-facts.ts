/**
 * One source of truth for facts the public website states. Every page reads
 * from here, so the home page, FAQ, Terms and Privacy Policy can never
 * disagree with each other again. Each value is backed by the product code:
 * change the code first, then this file.
 */

export const COMPANY = {
  legalName: "Mindwhile IT Solutions Private Limited",
  shortName: "Mindwhile IT Solutions Pvt Ltd",
  cin: "U72900AP2022PTC122855",
  address: "4th Floor, Mayuri Tech Park, Mangalagiri, Guntur, Andhra Pradesh 522503, India",
  email: "support@mindwhile.com",
  phone: "+91 81437 52025",
  phoneHref: "tel:+918143752025",
  website: "https://neuratalk.in",
};

/** Mirrors flutter_app/lib/utils/languages.dart (the app's language picker). */
export const INDIAN_LANGUAGES = [
  "Hindi", "Telugu", "Tamil", "Kannada", "Malayalam", "Marathi",
  "Bengali", "Gujarati", "Punjabi", "Odia", "Urdu",
];
export const INTERNATIONAL_LANGUAGES = [
  "Spanish", "French", "German", "Arabic", "Japanese", "Korean",
  "Chinese", "Portuguese", "Russian", "Italian", "Dutch",
];
export const LANGUAGES = ["English", ...INDIAN_LANGUAGES, ...INTERNATIONAL_LANGUAGES];
export const LANGUAGE_SUMMARY = `${LANGUAGES.length} languages — English, ${INDIAN_LANGUAGES.length} Indian languages and ${INTERNATIONAL_LANGUAGES.length} international languages`;

/** Who processes what, and where (checked against the code and production settings, 1 November 2026). */
export const PROCESSORS = [
  { name: "Amazon Web Services", purpose: "Application servers, the database (accounts, chats, business messages, call history), files and backups", location: "India (Mumbai)" },
  { name: "Microsoft Azure", purpose: "Speech recognition, and AI translation of calls", location: "India (Central India, South India)" },
  { name: "LiveKit", purpose: "Real-time audio and video for calls", location: "Nearest region on its global network (India for callers in India)" },
  { name: "ElevenLabs", purpose: "Learning your voice (only if you allow it) and speaking translated words in it", location: "United States / European Union" },
  { name: "OpenAI", purpose: "Translation of chat messages; backup translation for calls when Azure is unavailable; the in-app assistant", location: "United States" },
  { name: "Deepgram", purpose: "Backup speech recognition, only when Azure is unavailable", location: "United States" },
  { name: "Sarvam AI", purpose: "Backup translation of chat messages", location: "India" },
  { name: "Google Firebase", purpose: "Phone-number sign-in (OTP) and app notifications", location: "Global" },
];

/** Free AI and pay-first rules (server/free-trial.ts, server/ai-chat-usage.ts, server/billing-engine.ts). */
export const FREE_AI_MINUTES = 5;
export const CHAT_MESSAGES_PER_AI_MINUTE = 10;

/** Backups (RDS automatic backups + .github/workflows/db-backup.yml). */
export const BACKUP_POINT_IN_TIME_DAYS = 14;
export const BACKUP_DAILY_DAYS = 35;
export const BACKUP_MONTHLY_DAYS = 90;
/** The database moved from Neon (Singapore) to AWS Mumbai on this date; the Singapore copy is deleted by DATABASE_MOVE_CLEANUP. */
export const DATABASE_MOVED = "1 November 2026";
export const DATABASE_MOVE_CLEANUP = "15 November 2026";

/** server/modules/transcripts/service.ts RETENTION_DAYS (default tier "none" = 30). */
export const CALL_TEXT_RETENTION_DAYS = 30;

/** Date shown on the legal pages rewritten in this pass. */
export const LEGAL_UPDATED = "1 November 2026";

/** Last full review of the policies (database moved to India, free AI minutes, pay-first billing). */
export const POLICIES_UPDATED = "1 November 2026";

/** Minimum age to use NeuraTalk (Terms, Privacy, Age policy). */
export const MINIMUM_AGE = 18;

/** server/modules/campaigns/frequency.ts DEFAULT_CUSTOMER_MARKETING_CAP_PER_DAY */
export const MARKETING_CAP_PER_DAY = 3;

/** Grievance timelines we commit to (IT Rules 2021 and DPDP Act). */
export const GRIEVANCE_ACK_HOURS = 24;
export const GRIEVANCE_RESOLVE_DAYS = 15;
/** IT Rules 2021 r.3(2)(b): content showing a person's private area or impersonating them, removed within 24 hours of a complaint. */
export const URGENT_REMOVAL_HOURS = 24;

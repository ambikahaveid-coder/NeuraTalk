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

/** Who processes what, and where (see server code and infrastructure). */
export const PROCESSORS = [
  { name: "Amazon Web Services", purpose: "Application servers and file storage", location: "India (Mumbai)" },
  { name: "Neon", purpose: "Database (accounts, chats, business messages, call history)", location: "Singapore" },
  { name: "LiveKit", purpose: "Real-time audio and video for calls", location: "Global network (nearest region)" },
  { name: "Microsoft Azure", purpose: "Speech recognition", location: "Cloud region chosen by the provider" },
  { name: "OpenAI", purpose: "Translation of speech and messages; the in-app assistant", location: "United States" },
  { name: "ElevenLabs", purpose: "Speaking translated words in your own cloned voice", location: "United States / European Union" },
  { name: "Google Firebase", purpose: "Phone-number sign-in (OTP) and app notifications", location: "Global" },
];

/** server/modules/transcripts/service.ts RETENTION_DAYS (default tier "none" = 30). */
export const CALL_TEXT_RETENTION_DAYS = 30;

/** Date shown on the legal pages rewritten in this pass. */
export const LEGAL_UPDATED = "24 October 2026";

/** Policies added or updated on 31 October 2026 (community, commerce, age, voice, business terms…). */
export const POLICIES_UPDATED = "31 October 2026";

/** Minimum age to use NeuraTalk (Terms, Privacy, Age policy). */
export const MINIMUM_AGE = 18;

/** server/modules/campaigns/frequency.ts DEFAULT_CUSTOMER_MARKETING_CAP_PER_DAY */
export const MARKETING_CAP_PER_DAY = 3;

/** Grievance timelines we commit to (IT Rules 2021 and DPDP Act). */
export const GRIEVANCE_ACK_HOURS = 24;
export const GRIEVANCE_RESOLVE_DAYS = 15;
/** IT Rules 2021 r.3(2)(b): content showing a person's private area or impersonating them, removed within 24 hours of a complaint. */
export const URGENT_REMOVAL_HOURS = 24;

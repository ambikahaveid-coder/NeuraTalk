/**
 * MULTI-LANGUAGE TRANSLATION SYSTEM
 * 
 * Provides:
 * - Static UI text translations
 * - Dynamic content fetching by language
 * - Language detection and preference storage
 * 
 * Languages supported:
 * - English (en)
 * - Telugu (te)
 * - Tamil (ta)
 * - Kannada (kn)
 * - Hindi (hi)
 * 
 * RULES (from requirements):
 * - Real spoken language (not bookish)
 * - Business-friendly tone
 * - Not movie dialogue style
 * - Same language across app + website
 */

import { db } from "./db";
import { supportedLanguages } from "@shared/schema";
import { eq } from "drizzle-orm";

// ============================================================================
// STATIC UI TRANSLATIONS
// ============================================================================

type TranslationKey = 
  | "common.loading"
  | "common.error"
  | "common.success"
  | "common.cancel"
  | "common.save"
  | "common.submit"
  | "common.delete"
  | "common.edit"
  | "common.back"
  | "common.next"
  | "common.search"
  | "auth.login"
  | "auth.logout"
  | "auth.signup"
  | "auth.otp_sent"
  | "auth.otp_enter"
  | "auth.otp_invalid"
  | "auth.otp_expired"
  | "nav.home"
  | "nav.about"
  | "nav.products"
  | "nav.contact"
  | "nav.dashboard"
  | "call.start"
  | "call.end"
  | "call.connecting"
  | "call.connected"
  | "call.translating"
  | "credit.balance"
  | "credit.low"
  | "credit.buy"
  | "error.network"
  | "error.server"
  | "error.unauthorized"
  | "error.not_found";

type TranslationMap = Record<TranslationKey, string>;

// English translations (default)
const en: TranslationMap = {
  "common.loading": "Loading...",
  "common.error": "Something went wrong",
  "common.success": "Done!",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.submit": "Submit",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.back": "Back",
  "common.next": "Next",
  "common.search": "Search",
  "auth.login": "Login",
  "auth.logout": "Logout",
  "auth.signup": "Sign Up",
  "auth.otp_sent": "OTP sent to your phone",
  "auth.otp_enter": "Enter the 6-digit code",
  "auth.otp_invalid": "Wrong code, please try again",
  "auth.otp_expired": "Code expired, request a new one",
  "nav.home": "Home",
  "nav.about": "About",
  "nav.products": "Products",
  "nav.contact": "Contact",
  "nav.dashboard": "Dashboard",
  "call.start": "Start Call",
  "call.end": "End Call",
  "call.connecting": "Connecting...",
  "call.connected": "Connected",
  "call.translating": "Translating...",
  "credit.balance": "Credit Balance",
  "credit.low": "Credits running low",
  "credit.buy": "Buy Credits",
  "error.network": "Check your internet connection",
  "error.server": "Server error, please try later",
  "error.unauthorized": "Please login again",
  "error.not_found": "Not found",
};

// Telugu translations (తెలుగు)
const te: TranslationMap = {
  "common.loading": "లోడ్ అవుతోంది...",
  "common.error": "ఏదో తప్పు జరిగింది",
  "common.success": "అయిపోయింది!",
  "common.cancel": "రద్దు చేయండి",
  "common.save": "సేవ్ చేయండి",
  "common.submit": "పంపించండి",
  "common.delete": "తొలగించండి",
  "common.edit": "మార్చండి",
  "common.back": "వెనుకకు",
  "common.next": "తదుపరి",
  "common.search": "వెతకండి",
  "auth.login": "లాగిన్",
  "auth.logout": "లాగౌట్",
  "auth.signup": "రిజిస్టర్",
  "auth.otp_sent": "OTP మీ ఫోన్‌కు పంపబడింది",
  "auth.otp_enter": "6 అంకెల కోడ్ ఎంటర్ చేయండి",
  "auth.otp_invalid": "తప్పు కోడ్, మళ్ళీ ట్రై చేయండి",
  "auth.otp_expired": "కోడ్ గడువు ముగిసింది, కొత్తది తీసుకోండి",
  "nav.home": "హోమ్",
  "nav.about": "మా గురించి",
  "nav.products": "ప్రొడక్ట్స్",
  "nav.contact": "సంప్రదించండి",
  "nav.dashboard": "డాష్‌బోర్డ్",
  "call.start": "కాల్ మొదలు పెట్టండి",
  "call.end": "కాల్ ముగించండి",
  "call.connecting": "కనెక్ట్ అవుతోంది...",
  "call.connected": "కనెక్ట్ అయింది",
  "call.translating": "అనువాదం అవుతోంది...",
  "credit.balance": "క్రెడిట్ బ్యాలన్స్",
  "credit.low": "క్రెడిట్స్ తక్కువగా ఉన్నాయి",
  "credit.buy": "క్రెడిట్స్ కొనండి",
  "error.network": "ఇంటర్నెట్ కనెక్షన్ చెక్ చేయండి",
  "error.server": "సర్వర్ ఎర్రర్, తర్వాత ట్రై చేయండి",
  "error.unauthorized": "దయచేసి మళ్ళీ లాగిన్ అవండి",
  "error.not_found": "కనుగొనబడలేదు",
};

// Tamil translations (தமிழ்)
const ta: TranslationMap = {
  "common.loading": "ஏற்றுகிறது...",
  "common.error": "ஏதோ தவறு நடந்தது",
  "common.success": "ஆயிற்று!",
  "common.cancel": "ரத்து செய்",
  "common.save": "சேமி",
  "common.submit": "சமர்ப்பி",
  "common.delete": "நீக்கு",
  "common.edit": "திருத்து",
  "common.back": "பின்செல்",
  "common.next": "அடுத்து",
  "common.search": "தேடு",
  "auth.login": "உள்நுழை",
  "auth.logout": "வெளியேறு",
  "auth.signup": "பதிவு செய்",
  "auth.otp_sent": "OTP உங்கள் போனுக்கு அனுப்பப்பட்டது",
  "auth.otp_enter": "6 இலக்க குறியீடை உள்ளிடுக",
  "auth.otp_invalid": "தவறான குறியீடு, மீண்டும் முயற்சிக்கவும்",
  "auth.otp_expired": "குறியீடு காலாவதியானது, புதியதைப் பெறுங்கள்",
  "nav.home": "முகப்பு",
  "nav.about": "எங்களைப் பற்றி",
  "nav.products": "தயாரிப்புகள்",
  "nav.contact": "தொடர்பு",
  "nav.dashboard": "டாஷ்போர்டு",
  "call.start": "அழைப்பைத் தொடங்கு",
  "call.end": "அழைப்பை முடி",
  "call.connecting": "இணைக்கிறது...",
  "call.connected": "இணைக்கப்பட்டது",
  "call.translating": "மொழிபெயர்க்கிறது...",
  "credit.balance": "கிரெடிட் இருப்பு",
  "credit.low": "கிரெடிட் குறைவாக உள்ளது",
  "credit.buy": "கிரெடிட் வாங்கு",
  "error.network": "இணைய இணைப்பைச் சரிபாருங்கள்",
  "error.server": "சர்வர் பிழை, பின்னர் முயற்சிக்கவும்",
  "error.unauthorized": "மீண்டும் உள்நுழையவும்",
  "error.not_found": "கிடைக்கவில்லை",
};

// Kannada translations (ಕನ್ನಡ)
const kn: TranslationMap = {
  "common.loading": "ಲೋಡ್ ಆಗುತ್ತಿದೆ...",
  "common.error": "ಏನೋ ತಪ್ಪಾಯಿತು",
  "common.success": "ಆಯಿತು!",
  "common.cancel": "ರದ್ದುಮಾಡಿ",
  "common.save": "ಉಳಿಸಿ",
  "common.submit": "ಸಲ್ಲಿಸಿ",
  "common.delete": "ಅಳಿಸಿ",
  "common.edit": "ಬದಲಾಯಿಸಿ",
  "common.back": "ಹಿಂದಕ್ಕೆ",
  "common.next": "ಮುಂದೆ",
  "common.search": "ಹುಡುಕಿ",
  "auth.login": "ಲಾಗಿನ್",
  "auth.logout": "ಲಾಗೌಟ್",
  "auth.signup": "ನೋಂದಣಿ",
  "auth.otp_sent": "OTP ನಿಮ್ಮ ಫೋನ್‌ಗೆ ಕಳುಹಿಸಲಾಗಿದೆ",
  "auth.otp_enter": "6 ಅಂಕಿಯ ಕೋಡ್ ನಮೂದಿಸಿ",
  "auth.otp_invalid": "ತಪ್ಪು ಕೋಡ್, ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ",
  "auth.otp_expired": "ಕೋಡ್ ಅವಧಿ ಮುಗಿಯಿತು, ಹೊಸದನ್ನು ಪಡೆಯಿರಿ",
  "nav.home": "ಮುಖಪುಟ",
  "nav.about": "ನಮ್ಮ ಬಗ್ಗೆ",
  "nav.products": "ಉತ್ಪನ್ನಗಳು",
  "nav.contact": "ಸಂಪರ್ಕ",
  "nav.dashboard": "ಡ್ಯಾಶ್‌ಬೋರ್ಡ್",
  "call.start": "ಕರೆ ಪ್ರಾರಂಭಿಸಿ",
  "call.end": "ಕರೆ ಮುಗಿಸಿ",
  "call.connecting": "ಸಂಪರ್ಕಿಸುತ್ತಿದೆ...",
  "call.connected": "ಸಂಪರ್ಕಿತವಾಗಿದೆ",
  "call.translating": "ಭಾಷಾಂತರಿಸುತ್ತಿದೆ...",
  "credit.balance": "ಕ್ರೆಡಿಟ್ ಬ್ಯಾಲೆನ್ಸ್",
  "credit.low": "ಕ್ರೆಡಿಟ್ ಕಡಿಮೆಯಾಗಿದೆ",
  "credit.buy": "ಕ್ರೆಡಿಟ್ ಖರೀದಿಸಿ",
  "error.network": "ಇಂಟರ್ನೆಟ್ ಸಂಪರ್ಕ ಪರಿಶೀಲಿಸಿ",
  "error.server": "ಸರ್ವರ್ ದೋಷ, ನಂತರ ಪ್ರಯತ್ನಿಸಿ",
  "error.unauthorized": "ದಯವಿಟ್ಟು ಮತ್ತೆ ಲಾಗಿನ್ ಆಗಿ",
  "error.not_found": "ಸಿಗಲಿಲ್ಲ",
};

// Hindi translations (हिंदी)
const hi: TranslationMap = {
  "common.loading": "लोड हो रहा है...",
  "common.error": "कुछ गलत हो गया",
  "common.success": "हो गया!",
  "common.cancel": "रद्द करें",
  "common.save": "सेव करें",
  "common.submit": "भेजें",
  "common.delete": "हटाएं",
  "common.edit": "बदलें",
  "common.back": "वापस",
  "common.next": "आगे",
  "common.search": "खोजें",
  "auth.login": "लॉगिन",
  "auth.logout": "लॉगआउट",
  "auth.signup": "रजिस्टर करें",
  "auth.otp_sent": "OTP आपके फोन पर भेजा गया",
  "auth.otp_enter": "6 अंकों का कोड डालें",
  "auth.otp_invalid": "गलत कोड, फिर से कोशिश करें",
  "auth.otp_expired": "कोड समाप्त हो गया, नया लें",
  "nav.home": "होम",
  "nav.about": "हमारे बारे में",
  "nav.products": "प्रोडक्ट्स",
  "nav.contact": "संपर्क",
  "nav.dashboard": "डैशबोर्ड",
  "call.start": "कॉल शुरू करें",
  "call.end": "कॉल खत्म करें",
  "call.connecting": "कनेक्ट हो रहा है...",
  "call.connected": "कनेक्ट हो गया",
  "call.translating": "अनुवाद हो रहा है...",
  "credit.balance": "क्रेडिट बैलेंस",
  "credit.low": "क्रेडिट कम हो रहे हैं",
  "credit.buy": "क्रेडिट खरीदें",
  "error.network": "इंटरनेट कनेक्शन चेक करें",
  "error.server": "सर्वर में गड़बड़, बाद में कोशिश करें",
  "error.unauthorized": "कृपया फिर से लॉगिन करें",
  "error.not_found": "नहीं मिला",
};

// All translations
const translations: Record<string, TranslationMap> = {
  en,
  te,
  ta,
  kn,
  hi,
};

// ============================================================================
// TRANSLATION FUNCTIONS
// ============================================================================

/**
 * Get a translation for a key
 */
export function t(key: TranslationKey, lang: string = "en"): string {
  const langMap = translations[lang] || translations["en"];
  return langMap[key] || translations["en"][key] || key;
}

/**
 * Get all translations for a language
 */
export function getTranslations(lang: string = "en"): TranslationMap {
  return translations[lang] || translations["en"];
}

/**
 * Get available languages from database
 */
export async function getAvailableLanguages() {
  return db.select().from(supportedLanguages).where(eq(supportedLanguages.isEnabled, true));
}

/**
 * Check if a language is supported
 */
export function isLanguageSupported(lang: string): boolean {
  return lang in translations;
}

/**
 * Get default language
 */
export async function getDefaultLanguage(): Promise<string> {
  const [defaultLang] = await db.select()
    .from(supportedLanguages)
    .where(eq(supportedLanguages.isDefault, true));
  return defaultLang?.code || "en";
}

// ============================================================================
// EXPRESS ROUTES
// ============================================================================

import { Express } from "express";

export function registerTranslationRoutes(app: Express) {
  /**
   * Get all translations for a language
   */
  app.get("/api/translations/:lang", (req, res) => {
    const { lang } = req.params;
    const langTranslations = getTranslations(lang);
    res.json({ success: true, data: langTranslations, lang });
  });

  /**
   * Get available languages
   */
  app.get("/api/languages", async (req, res) => {
    try {
      const languages = await getAvailableLanguages();
      res.json({ success: true, data: languages });
    } catch (err) {
      res.status(500).json({ success: false, message: "Failed to fetch languages" });
    }
  });
}

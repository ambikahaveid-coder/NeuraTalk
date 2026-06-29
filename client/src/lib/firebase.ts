import { getApp, getApps, initializeApp, FirebaseApp } from "firebase/app";
import { 
  getAuth, 
  RecaptchaVerifier, 
  signInWithPhoneNumber, 
  ConfirmationResult,
  Auth,
  PhoneAuthProvider,
  signInWithCredential
} from "firebase/auth";
import { normalizePhoneNumber } from "@shared/phone";

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let recaptchaVerifier: RecaptchaVerifier | null = null;

/**
 * Firebase Phone Auth is the sole mobile OTP provider.
 * There is no SMS fallback — if Firebase is not configured the login screen
 * will show an error and the user must contact support.
 */
export function getPhoneOtpProvider(): "firebase" {
  return "firebase";
}

export function shouldUseFirebasePhoneOtp(): boolean {
  return true;
}

// Firebase Web config is public-facing (used in client-side JS bundle).
// Fallbacks ensure the app works even when VITE_ env vars aren't set at build time.
const FB_DEFAULTS = {
  apiKey: "AIzaSyDMn1dPIAAAdYiFSiAzUG65dg1o85w_A7Q",
  projectId: "neuratalk-c6683",
  appId: "1:612487293092:web:2aa2cf6d2c33e74b335e31",
  authDomain: "neuratalk-c6683.firebaseapp.com",
  storageBucket: "neuratalk-c6683.firebasestorage.app",
  messagingSenderId: "612487293092",
  measurementId: "G-71G09M618D",
};

export function initializeFirebase(): boolean {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY || FB_DEFAULTS.apiKey;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || FB_DEFAULTS.projectId;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID || FB_DEFAULTS.appId;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || FB_DEFAULTS.authDomain;
  const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || FB_DEFAULTS.storageBucket;
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || FB_DEFAULTS.messagingSenderId;
  const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || FB_DEFAULTS.measurementId;

  if (!apiKey || !projectId || !appId) {
    console.error("[NeuraTalk] Firebase config missing — phone OTP will not work.");
    return false;
  }

  try {
    const firebaseConfig = {
      apiKey,
      authDomain,
      projectId,
      storageBucket,
      messagingSenderId,
      appId,
      measurementId,
    };

    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
    return true;
  } catch (error) {
    console.error("[NeuraTalk] Firebase initialization failed:", error);
    return false;
  }
}

export function isFirebaseAvailable(): boolean {
  return !!auth;
}

export function setupRecaptcha(containerId: string): RecaptchaVerifier | null {
  if (!auth) return null;

  // Always clear and recreate to avoid "already rendered" error
  if (recaptchaVerifier) {
    try { recaptchaVerifier.clear(); } catch (_) {}
    recaptchaVerifier = null;
  }

  // Ensure the container element is empty before creating verifier
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = "";

  recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
    size: "invisible",
    callback: () => {},
    "expired-callback": () => {
      try { recaptchaVerifier?.clear(); } catch (_) {}
      recaptchaVerifier = null;
    },
  });

  return recaptchaVerifier;
}

export async function sendOtpWithFirebase(
  phoneNumber: string
): Promise<ConfirmationResult | null> {
  if (!auth || !recaptchaVerifier) {
    console.error("Firebase auth or reCAPTCHA not initialized");
    return null;
  }

  try {
    const formattedPhone = normalizePhoneNumber(phoneNumber);
    
    const confirmationResult = await signInWithPhoneNumber(
      auth, 
      formattedPhone, 
      recaptchaVerifier
    );
    return confirmationResult;
  } catch (error) {
    console.error("Firebase OTP send failed:", error);
    throw error;
  }
}

export function getFirebasePhoneAuthErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";

  switch (code) {
    case "auth/invalid-phone-number":
      return "Phone number format is invalid.";
    case "auth/too-many-requests":
      return "Too many OTP attempts. Please wait a few minutes and try again.";
    case "auth/captcha-check-failed":
      return "Security verification failed. Please refresh and try again.";
    case "auth/app-not-authorized":
      return "This app is not authorized for Firebase Phone Auth. Check Firebase Console → Authentication → Sign-in providers → Phone.";
    case "auth/invalid-app-credential":
    case "auth/internal-error":
      return "Firebase configuration error. Contact support if this persists.";
    default:
      return code ? `Phone verification failed (${code}).` : "Phone verification failed.";
  }
}

export async function verifyOtpWithFirebase(
  confirmationResult: ConfirmationResult,
  code: string
): Promise<string | null> {
  try {
    const result = await confirmationResult.confirm(code);
    const idToken = await result.user.getIdToken();
    return idToken;
  } catch (error) {
    console.error("Firebase OTP verification failed:", error);
    throw error;
  }
}

export function getFirebaseAuth(): Auth | null {
  return auth;
}

export function clearRecaptcha(): void {
  if (recaptchaVerifier) {
    recaptchaVerifier.clear();
    recaptchaVerifier = null;
  }
}

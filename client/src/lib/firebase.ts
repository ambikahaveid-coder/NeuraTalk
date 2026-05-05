import { initializeApp, FirebaseApp } from "firebase/app";
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

export function initializeFirebase(): boolean {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`;
  const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID;
  const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID;

  if (!apiKey || !projectId || !appId) {
    console.warn("Firebase config not available - using fallback OTP");
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

    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    return true;
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    return false;
  }
}

export function isFirebaseAvailable(): boolean {
  return !!auth;
}

export function setupRecaptcha(containerId: string): RecaptchaVerifier | null {
  if (!auth) return null;

  if (recaptchaVerifier) {
    recaptchaVerifier.clear();
  }

  recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
    size: "invisible",
    callback: () => {
      console.log("reCAPTCHA verified");
    },
    "expired-callback": () => {
      console.log("reCAPTCHA expired");
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

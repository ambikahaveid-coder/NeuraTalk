/**
 * Phone-OTP login page for the Android app's in-app WebView.
 *
 * Native Firebase phone auth on Android requires Google device verification
 * (Play Integrity / an app-bound reCAPTCHA), which fails for builds not
 * installed from Google Play. The web reCAPTCHA flow works, so the app opens
 * this page, the user verifies here, and the resulting NeuraTalk session token
 * is handed to the app through the `NeuraTalkApp` JavaScript channel (an
 * in-process bridge — the token is never put in a URL).
 */
import { useEffect, useRef, useState } from "react";
import type { ConfirmationResult } from "firebase/auth";
import {
  initializeFirebase,
  setupRecaptcha,
  sendOtpWithFirebase,
  verifyOtpWithFirebase,
  getFirebasePhoneAuthErrorMessage,
  clearRecaptcha,
} from "@/lib/firebase";

declare global {
  interface Window {
    NeuraTalkApp?: { postMessage: (message: string) => void };
  }
}

function postToApp(message: Record<string, unknown>) {
  window.NeuraTalkApp?.postMessage(JSON.stringify(message));
}

export default function AppLogin() {
  const params = new URLSearchParams(window.location.search);
  const initialDigits = (params.get("phone") || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "").slice(-10);

  const [digits, setDigits] = useState(initialDigits);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code" | "done">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmation = useRef<ConfirmationResult | null>(null);

  useEffect(() => {
    initializeFirebase();
    return () => {
      try { clearRecaptcha(); } catch { /* already cleared */ }
    };
  }, []);

  async function sendCode() {
    if (digits.length !== 10) {
      setError("Enter your 10-digit mobile number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setupRecaptcha("app-login-recaptcha");
      const result = await sendOtpWithFirebase(`+91${digits}`);
      if (!result) throw new Error("Phone login is not available right now.");
      confirmation.current = result;
      setStep("code");
    } catch (err) {
      setError(getFirebasePhoneAuthErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    const otp = code.replace(/\D/g, "");
    if (otp.length !== 6 || !confirmation.current) {
      setError("Enter the 6-digit code from the SMS.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const idToken = await verifyOtpWithFirebase(confirmation.current, otp);
      if (!idToken) throw new Error("Verification failed.");
      const res = await fetch("/api/auth/firebase-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.token) {
        throw new Error(data?.message || "Login failed. Please try again.");
      }
      setStep("done");
      postToApp({ type: "login", token: data.token, user: data.user ?? null });
    } catch (err) {
      const code = typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code) : "";
      setError(
        code === "auth/invalid-verification-code"
          ? "Wrong code. Please check the SMS and try again."
          : code === "auth/code-expired"
            ? "The code expired. Please request a new one."
            : err instanceof Error && !code ? err.message : getFirebasePhoneAuthErrorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-xl border-2 border-slate-600 bg-slate-900 px-4 py-4 text-2xl text-white tracking-wider outline-none focus:border-cyan-400";
  const button = "w-full rounded-xl bg-cyan-500 py-4 text-xl font-bold text-slate-950 disabled:opacity-50";

  return (
    <div className="min-h-screen bg-slate-950 px-5 py-10 text-white">
      <div className="mx-auto max-w-md">
        <h1 className="text-center text-4xl font-extrabold">NeuraTalk</h1>
        <p className="mt-2 text-center text-lg text-slate-400">Sign in with your mobile number</p>

        <div className="mt-10 space-y-5">
          {step === "phone" && (
            <>
              <label className="block text-lg text-slate-300" htmlFor="phone">Mobile number</label>
              <div className="flex items-center gap-3">
                <span className="text-2xl text-slate-300">+91</span>
                <input
                  id="phone"
                  className={input}
                  inputMode="numeric"
                  autoComplete="tel-national"
                  value={digits}
                  onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="98765 43210"
                />
              </div>
              <button className={button} disabled={busy} onClick={sendCode}>
                {busy ? "Sending…" : "Send OTP"}
              </button>
            </>
          )}

          {step === "code" && (
            <>
              <p className="text-lg text-slate-300">Code sent to +91 {digits}</p>
              <input
                className={`${input} text-center`}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="------"
              />
              <button className={button} disabled={busy} onClick={verifyCode}>
                {busy ? "Verifying…" : "Verify & Login"}
              </button>
              <button
                className="w-full py-3 text-lg text-cyan-400"
                disabled={busy}
                onClick={() => { setStep("phone"); setCode(""); setError(null); }}
              >
                Change number
              </button>
            </>
          )}

          {step === "done" && (
            <p className="text-center text-2xl font-bold text-emerald-400">Logged in. Opening NeuraTalk…</p>
          )}

          {error && <p className="rounded-xl bg-red-950 px-4 py-3 text-lg text-red-300">{error}</p>}
          <div id="app-login-recaptcha" />
        </div>
      </div>
    </div>
  );
}

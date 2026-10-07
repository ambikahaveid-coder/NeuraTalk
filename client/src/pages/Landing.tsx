import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Loader2, Mic, Sparkles, Volume2, Building2, User, 
  Mail, Phone, ArrowRight, ArrowLeft, Check, Clock,
  Globe, Users, Shield, ExternalLink
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { LogoWithIcon } from "@/components/Logo";
import { usePublicTheme } from "@/components/theme-toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { countries, DEFAULT_COUNTRY_CODE, validatePhoneNumber, sanitizePhoneInput } from "@shared/countries";
import { normalizePhoneForCountry } from "@shared/phone";
import { ConfirmationResult } from "firebase/auth";
import { 
  getPhoneOtpProvider,
  initializeFirebase, 
  getFirebasePhoneAuthErrorMessage,
  setupRecaptcha, 
  sendOtpWithFirebase, 
  verifyOtpWithFirebase,
  clearRecaptcha 
} from "@/lib/firebase";

type Step = "choose" | "identifier" | "otp" | "company-details" | "pending" | "forgot-password" | "reset-password";
type AccountType = "consumer" | "business";
type Channel = "email" | "mobile";

const SIGNUP_FLOW_KEY = "neuratalk_signup_flow";

function getSignupFlow(): { step: Step; accountType: AccountType } | null {
  try {
    const stored = sessionStorage.getItem(SIGNUP_FLOW_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function setSignupFlow(step: Step, accountType: AccountType) {
  sessionStorage.setItem(SIGNUP_FLOW_KEY, JSON.stringify({ step, accountType }));
}

function clearSignupFlow() {
  sessionStorage.removeItem(SIGNUP_FLOW_KEY);
}

function normalizeIdentifierByChannel(identifier: string, channel: Channel, countryCode: string): string {
  return channel === "mobile" ? normalizePhoneForCountry(identifier, countryCode) : identifier.trim();
}

export default function Landing() {
  usePublicTheme();
  const savedFlow = getSignupFlow();
  const [step, setStepState] = useState<Step>(savedFlow?.step && savedFlow.step !== "choose" ? savedFlow.step : "identifier");
  const [accountType] = useState<AccountType>(savedFlow?.accountType === "business" ? "business" : "consumer");
  
  const setStep = (newStep: Step) => {
    setStepState(newStep);
    setSignupFlow(newStep, accountType);
  };
  const [channel, setChannel] = useState<Channel>("email");
  const [phoneCountryCode, setPhoneCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [identifier, setIdentifier] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [companyDetails, setCompanyDetails] = useState({
    companyName: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    industry: "",
    size: "",
    website: "",
  });

  // Forgot password state
  const [newPassword, setNewPassword] = useState("");
  const [isForgotLoading, setIsForgotLoading] = useState(false);

  // Firebase Phone Auth state
  const [firebaseEnabled, setFirebaseEnabled] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [isSendingFirebaseOtp, setIsSendingFirebaseOtp] = useState(false);
  const [isVerifyingFirebaseOtp, setIsVerifyingFirebaseOtp] = useState(false);
  const recaptchaContainerRef = useRef<HTMLDivElement>(null);

  // Initialize Firebase on mount
  useEffect(() => {
    const initialized = initializeFirebase();
    setFirebaseEnabled(initialized);
    return () => clearRecaptcha();
  }, []);

  const phoneOtpProvider = getPhoneOtpProvider();

  const { 
    requestOtp, isRequestingOtp,
    verifyOtp, isVerifyingOtp,
    companySignup, isSigningUp,
  } = useAuth();
  const { toast } = useToast();

  const handleRequestOtp = async () => {
    if (channel === "mobile") {
      const validation = validatePhoneNumber(identifier, phoneCountryCode);
      if (!validation.valid) {
        toast({ title: "Invalid phone number", description: validation.message, variant: "destructive" });
        return;
      }
    }
    const normalizedIdentifier = normalizeIdentifierByChannel(identifier, channel, phoneCountryCode);
    let usedFirebaseFlow = false;

    try {
      if (channel === "mobile") {
        // Firebase Phone Auth is the only mobile authentication method.
        // If Firebase is not initialized, block login with a clear error.
        if (!firebaseEnabled) {
          toast({
            title: "Phone login unavailable",
            description: "Firebase Phone Auth is not configured. Please use email login or contact support.",
            variant: "destructive",
          });
          return;
        }

        setIsSendingFirebaseOtp(true);
        try {
          const verifier = setupRecaptcha("recaptcha-container");
          if (!verifier) {
            throw new Error("Firebase reCAPTCHA could not be initialized. Please refresh the page and try again.");
          }

          const result = await sendOtpWithFirebase(normalizedIdentifier);
          if (!result) {
            throw new Error("Failed to send OTP. Please try again.");
          }

          setConfirmationResult(result);
          setIdentifier(normalizedIdentifier);
          toast({ title: "OTP Sent", description: "Check your phone for the Firebase verification code." });
          setStep("otp");
        } catch (err: any) {
          setConfirmationResult(null);
          toast({
            title: "Phone verification failed",
            description: getFirebasePhoneAuthErrorMessage(err),
            variant: "destructive",
          });
        } finally {
          setIsSendingFirebaseOtp(false);
        }
        return;
      } else {
        // Email OTP uses the server email provider (Resend).
        await requestOtp({ identifier: normalizedIdentifier, channel });
        setConfirmationResult(null);
        setIdentifier(normalizedIdentifier);
        toast({ title: "OTP Sent", description: "Check your email for the verification code." });
        setStep("otp");
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleVerifyOtp = async () => {
    const normalizedIdentifier = normalizeIdentifierByChannel(identifier, channel, phoneCountryCode);

    try {
      if (confirmationResult) {
        // Mobile: verify Firebase OTP, then exchange ID token with backend
        setIsVerifyingFirebaseOtp(true);
        try {
          const idToken = await verifyOtpWithFirebase(confirmationResult, otpCode);
          if (idToken) {
            const result = await verifyOtp({ identifier: normalizedIdentifier, channel, code: otpCode, firebaseToken: idToken });
            handleVerifySuccess(result);
          }
        } catch (err: any) {
          toast({ title: "Invalid OTP", description: "The code you entered is incorrect. Please check and try again.", variant: "destructive" });
        } finally {
          setIsVerifyingFirebaseOtp(false);
        }
      } else if (channel === "email") {
        // Email: use server OTP verification
        const result = await verifyOtp({ identifier: normalizedIdentifier, channel, code: otpCode });
        handleVerifySuccess(result);
      } else {
        // Mobile without Firebase confirmation — should not reach here
        toast({
          title: "Session expired",
          description: "Please go back and request a new OTP.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({ title: "Invalid OTP", description: err.message, variant: "destructive" });
    }
  };

  const handleVerifySuccess = (result: any) => {
    if (result.success) {
      if (accountType === "business") {
        // Check if user already has an approved organization
        if (result.user?.organization) {
          const org = result.user.organization;
          if (org.status === "approved") {
            clearSignupFlow();
            window.location.href = "/company";
            return;
          } else if (org.status === "pending") {
            setStep("pending"); // keeps Landing visible (needsBusinessSignup stays true)
            return;
          }
        }
        // New business user - show company details form
        setCompanyDetails(prev => ({
          ...prev,
          contactEmail: channel === "email" ? identifier : prev.contactEmail,
          contactPhone: channel === "mobile" ? identifier : prev.contactPhone,
        }));
        setStep("company-details");
      } else {
        // Consumer / admin user - clear session and redirect immediately
        clearSignupFlow();
        if (result.user) {
          const role = result.user.role;
          if (role === "super_admin") {
            window.location.href = "/admin";
          } else if (role === "company_admin" || role === "agent") {
            window.location.href = "/company";
          } else {
            window.location.href = "/dashboard";
          }
        }
      }
    }
  };

  const handleCompanySignup = async () => {
    try {
      await companySignup(companyDetails);
      clearSignupFlow();
      setStep("pending");
    } catch (err: any) {
      toast({ title: "Signup Failed", description: err.message, variant: "destructive" });
    }
  };

  const handleForgotPasswordRequest = async () => {
    if (!identifier) {
      toast({ title: "Error", description: "Please enter your email or phone number", variant: "destructive" });
      return;
    }
    if (channel === "mobile") {
      const validation = validatePhoneNumber(identifier, phoneCountryCode);
      if (!validation.valid) {
        toast({ title: "Invalid phone number", description: validation.message, variant: "destructive" });
        return;
      }
    }
    const normalizedIdentifier = normalizeIdentifierByChannel(identifier, channel, phoneCountryCode);
    setIsForgotLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: normalizedIdentifier, channel }),
      });
      const data = await res.json();
      if (data.success) {
        setIdentifier(normalizedIdentifier);
        toast({ title: "Code Sent", description: `Reset code sent to your ${channel}` });
        setStep("reset-password");
      } else {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to send reset code", variant: "destructive" });
    } finally {
      setIsForgotLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!otpCode || !newPassword) {
      toast({ title: "Error", description: "Enter both OTP code and new password", variant: "destructive" });
      return;
    }
    const normalizedIdentifier = normalizeIdentifierByChannel(identifier, channel, phoneCountryCode);
    setIsForgotLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: normalizedIdentifier, channel, code: otpCode, newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Password Reset!", description: "Logging you in..." });
        if (data.token && data.user) {
          localStorage.setItem("neuratalk_auth", JSON.stringify({ token: data.token, user: data.user }));
        }
        clearSignupFlow();
        setTimeout(() => { window.location.href = "/dashboard"; }, 800);
      } else {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Reset failed. Please try again.", variant: "destructive" });
    } finally {
      setIsForgotLoading(false);
    }
  };

  const isOtpLoading = isRequestingOtp || isSendingFirebaseOtp;
  const isVerifying = isVerifyingOtp || isVerifyingFirebaseOtp;

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr] bg-background">
      {/* Brand panel (mockup 01): navy with a soft blue glow */}
      <aside className="relative overflow-hidden px-6 pt-6 pb-10 lg:px-14 lg:py-12 flex flex-col bg-[#0B1530] bg-[radial-gradient(ellipse_at_80%_110%,rgba(30,102,245,0.45),transparent_55%),radial-gradient(ellipse_at_0%_0%,rgba(42,168,255,0.18),transparent_45%)]">
        <div className="flex items-center justify-between">
          <Link href="/" data-testid="link-home">
            <span className="cursor-pointer"><LogoWithIcon size="md" tagline onDark /></span>
          </Link>
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-1 text-white/80 hover:text-white">
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Home</span>
            </Button>
          </Link>
        </div>

        <div className="mt-10 lg:mt-auto lg:mb-auto max-w-lg">
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-white leading-[1.1]">
            Talk to anyone, <span className="text-[#5AB4FF]">in their own language.</span>
          </h1>
          <p className="mt-4 text-base md:text-lg text-white/75 leading-relaxed">
            Voice calls, video calls and chat, translated live. Speak naturally, mix languages, and you will still be understood.
          </p>
          <ul className="mt-8 hidden md:grid gap-4">
            {[
              { icon: <Phone className="w-5 h-5" />, t: "Translated voice & video calls", d: "Hear the other person in your language, with live captions." },
              { icon: <Globe className="w-5 h-5" />, t: "Chat in 20 languages", d: "Telugu, Hindi, Tamil, English and more, auto-translated." },
              { icon: <Users className="w-5 h-5" />, t: "Face to face on one phone", d: "Talk with someone next to you, each in your own language." },
              { icon: <Building2 className="w-5 h-5" />, t: "For business teams", d: "Teams, call routing and usage reports for your company." },
            ].map((f) => (
              <li key={f.t} className="flex gap-3">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#7CC4FF]">{f.icon}</span>
                <span>
                  <span className="block font-semibold text-white">{f.t}</span>
                  <span className="block text-sm text-white/65">{f.d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="hidden lg:block text-sm text-white/50">© Mindwhile IT Solutions Pvt Ltd · support@mindwhile.com</p>
      </aside>

      {/* Sign-in card */}
      <main className="relative flex items-start lg:items-center justify-center px-4 pb-12 lg:py-12 lg:bg-muted">
        {/* Invisible reCAPTCHA container for Firebase Phone Auth */}
        <div id="recaptcha-container" ref={recaptchaContainerRef} className="absolute" />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
        <motion.div
          className="rounded-3xl border border-border bg-card p-6 sm:p-8 shadow-2xl shadow-black/10 dark:shadow-black/30 relative z-10 overflow-hidden"
          layout
        >
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-foreground">Welcome back</h2>
            <p className="text-sm text-muted-foreground mt-1">Sign in with your mobile number or email. New here? We'll create your account.</p>
          </div>
                    <AnimatePresence mode="wait">
            {step === "identifier" && (
              <>
                <IdentifierStep
                  channel={channel}
                  setChannel={setChannel}
                  phoneCountryCode={phoneCountryCode}
                  setPhoneCountryCode={setPhoneCountryCode}
                  identifier={identifier}
                  setIdentifier={setIdentifier}
                  isLoading={isOtpLoading}
                  onContinue={handleRequestOtp}
                  firebaseEnabled={firebaseEnabled}
                />
                {accountType === "business" && (
                  <div className="mt-4 text-center">
                    <button
                      onClick={() => setStep("forgot-password")}
                      className="text-xs text-muted-foreground hover:text-primary transition-colors"
                    >
                      Forgot password? Reset via OTP
                    </button>
                  </div>
                )}
              </>
            )}

            {step === "otp" && (
              <OtpStep
                channel={channel}
                identifier={identifier}
                otpCode={otpCode}
                setOtpCode={setOtpCode}
                isLoading={isVerifying}
                onBack={() => {
                  setConfirmationResult(null);
                  setStep("identifier");
                }}
                onContinue={handleVerifyOtp}
                onResend={handleRequestOtp}
              />
            )}

            {step === "company-details" && (
              <CompanyDetailsStep
                details={companyDetails}
                setDetails={setCompanyDetails}
                isLoading={isSigningUp}
                onBack={() => setStep("otp")}
                onContinue={handleCompanySignup}
              />
            )}

            {step === "pending" && (
              <PendingApprovalStep companyName={companyDetails.companyName} />
            )}

            {step === "forgot-password" && (
              <motion.div key="forgot-password" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <button onClick={() => setStep("identifier")} className="flex items-center gap-1 text-sm text-muted-foreground mb-6 hover:text-foreground">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <h2 className="text-2xl font-bold mb-2">Reset Password</h2>
                <p className="text-sm text-muted-foreground mb-6">Enter your email or phone to receive a reset code</p>
                <div className="flex gap-2 mb-4">
                  <button onClick={() => setChannel("email")} className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${channel === "email" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-input"}`}>
                    <Mail className="w-4 h-4 inline mr-1" /> Email
                  </button>
                  <button onClick={() => setChannel("mobile")} className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${channel === "mobile" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-input"}`}>
                    <Phone className="w-4 h-4 inline mr-1" /> Mobile
                  </button>
                </div>
                {channel === "mobile" ? (
                  <div className="grid grid-cols-[150px_1fr] gap-2 mb-4">
                    <Select value={phoneCountryCode} onValueChange={setPhoneCountryCode}>
                      <SelectTrigger className="bg-muted border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {countries.map((country) => (
                          <SelectItem key={country.code} value={country.code}>
                            {country.name} ({country.dialCode})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <input
                      type="tel"
                      placeholder="Phone number"
                      value={identifier}
                      onChange={e => {
                        const selectedCountry = countries.find((country) => country.code === phoneCountryCode);
                        setIdentifier(sanitizePhoneInput(e.target.value, selectedCountry?.phoneLength || 15));
                      }}
                      className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50"
                    />
                  </div>
                ) : (
                  <input
                    type="email"
                    placeholder="your@email.com"
                    value={identifier}
                    onChange={e => setIdentifier(e.target.value)}
                    className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-sm mb-4 focus:outline-none focus:border-primary/50"
                  />
                )}
                {channel === "mobile" && (
                  <p className="text-xs text-center text-muted-foreground mb-4">
                    Country code is applied automatically for OTP and password reset.
                  </p>
                )}
                <Button onClick={handleForgotPasswordRequest} disabled={isForgotLoading} className="w-full">
                  {isForgotLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Send Reset Code
                </Button>
              </motion.div>
            )}

            {step === "reset-password" && (
              <motion.div key="reset-password" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <button onClick={() => setStep("forgot-password")} className="flex items-center gap-1 text-sm text-muted-foreground mb-6 hover:text-foreground">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <h2 className="text-2xl font-bold mb-2">Set New Password</h2>
                <p className="text-sm text-muted-foreground mb-6">Enter the code sent to {identifier}</p>
                <input
                  type="text"
                  placeholder="Enter 6-digit OTP"
                  maxLength={6}
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value)}
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-sm mb-3 text-center text-2xl tracking-widest focus:outline-none focus:border-primary/50"
                />
                <input
                  type="password"
                  placeholder="New password (min 6 chars)"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-sm mb-4 focus:outline-none focus:border-primary/50"
                />
                <Button onClick={handleResetPassword} disabled={isForgotLoading} className="w-full mb-3">
                  {isForgotLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Reset Password
                </Button>
                <button onClick={handleForgotPasswordRequest} className="w-full text-sm text-muted-foreground hover:text-foreground text-center">
                  Resend Code
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing you agree to our{" "}
          <Link href="/terms" className="underline hover:text-foreground">Terms</Link> and{" "}
          <Link href="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
        </p>
        </motion.div>

        {/* Discreet system access link */}
        <Link href="/sys" className="fixed bottom-4 right-4 text-xs text-muted-foreground/30 hover:text-muted-foreground/50 transition-colors">
          v1.0
        </Link>
      </main>
    </div>
  );
}



function IdentifierStep({
  channel,
  setChannel,
  phoneCountryCode,
  setPhoneCountryCode,
  identifier,
  setIdentifier,
  isLoading,
  onBack,
  onContinue,
  firebaseEnabled,
}: {
  channel: Channel;
  setChannel: (c: Channel) => void;
  phoneCountryCode: string;
  setPhoneCountryCode: (value: string) => void;
  identifier: string;
  setIdentifier: (v: string) => void;
  isLoading: boolean;
  onBack?: () => void;
  onContinue: () => void;
  firebaseEnabled?: boolean;
}) {
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim());
  const canContinue = channel === "mobile" ? !!identifier : emailLooksValid;

  return (
    <motion.div
      key="identifier"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-4"
    >
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-back-identifier"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </button>
      )}

      <div className="text-center mb-4">
        <p className="text-sm text-muted-foreground">We'll send you a one-time code.</p>
      </div>

      <div className="flex gap-2 p-1 rounded-lg bg-muted">
        <button
          onClick={() => { setChannel("email"); setIdentifier(""); }}
          data-testid="button-channel-email"
          className={`flex-1 py-2 px-3 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-all ${
            channel === "email" ? "bg-foreground/10 text-foreground" : "text-muted-foreground"
          }`}
        >
          <Mail className="w-4 h-4" /> Email
        </button>
        <button
          onClick={() => { setChannel("mobile"); setIdentifier(""); }}
          data-testid="button-channel-mobile"
          className={`flex-1 py-2 px-3 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-all ${
            channel === "mobile" ? "bg-foreground/10 text-foreground" : "text-muted-foreground"
          }`}
        >
          <Phone className="w-4 h-4" /> Mobile
        </button>
      </div>

      {channel === "mobile" ? (
        <div className="grid grid-cols-[150px_1fr] gap-2">
          <Select value={phoneCountryCode} onValueChange={setPhoneCountryCode}>
            <SelectTrigger data-testid="select-identifier-country">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {countries.map((country) => (
                <SelectItem key={country.code} value={country.code}>
                  {country.name} ({country.dialCode})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="tel"
            placeholder="Phone number"
            value={identifier}
            onChange={(e) => {
              const selectedCountry = countries.find((country) => country.code === phoneCountryCode);
              setIdentifier(sanitizePhoneInput(e.target.value, selectedCountry?.phoneLength || 15));
            }}
            data-testid="input-identifier"
            className="text-center text-lg"
          />
        </div>
      ) : (
        <Input
          type="email"
          placeholder="you@example.com"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          data-testid="input-identifier"
          className="text-center text-lg"
        />
      )}

      {channel === "mobile" && firebaseEnabled ? (
        <p className="text-xs text-center text-muted-foreground">
          A one-time code will be sent to your phone via Firebase.
        </p>
      ) : channel === "mobile" ? (
        <p className="text-xs text-center text-muted-foreground text-destructive">
          Phone login requires Firebase configuration. Please use email login.
        </p>
      ) : identifier && !emailLooksValid ? (
        <p className="text-xs text-center text-destructive">
          Enter a valid email address.
        </p>
      ) : (
        <p className="text-xs text-center text-muted-foreground">
          OTP will be sent to your email.
        </p>
      )}

      <Button
        onClick={onContinue}
        className="w-full"
        size="lg"
        disabled={!canContinue || isLoading}
        data-testid="button-send-otp"
      >
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Send Code <ArrowRight className="w-4 h-4 ml-2" /></>}
      </Button>
    </motion.div>
  );
}

function OtpStep({
  channel,
  identifier,
  otpCode,
  setOtpCode,
  isLoading,
  onBack,
  onContinue,
  onResend,
}: {
  channel: Channel;
  identifier: string;
  otpCode: string;
  setOtpCode: (v: string) => void;
  isLoading: boolean;
  onBack: () => void;
  onContinue: () => void;
  onResend: () => void;
}) {
  return (
    <motion.div
      key="otp"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-4"
    >
      <button 
        onClick={onBack} 
        className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        data-testid="button-back-otp"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </button>

      <div className="text-center mb-4">
        <h2 className="text-lg font-semibold">Enter Verification Code</h2>
        <p className="text-sm text-muted-foreground">
          Sent to {identifier}
        </p>
      </div>

      <Input
        type="text"
        placeholder="000000"
        value={otpCode}
        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        data-testid="input-otp"
        className="text-center text-2xl tracking-[0.5em] font-mono"
        maxLength={6}
      />

      <Button 
        onClick={onContinue} 
        className="w-full" 
        size="lg"
        disabled={otpCode.length !== 6 || isLoading}
        data-testid="button-verify-otp"
      >
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Verify <Check className="w-4 h-4 ml-2" /></>}
      </Button>

      <button 
        onClick={onResend}
        className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
        data-testid="button-resend-otp"
      >
        Didn't receive code? <span className="text-primary">Resend</span>
      </button>
    </motion.div>
  );
}

function CompanyDetailsStep({
  details,
  setDetails,
  isLoading,
  onBack,
  onContinue,
}: {
  details: typeof import("./Landing").default extends () => any ? any : never;
  setDetails: (d: any) => void;
  isLoading: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  const update = (field: string, value: string) => {
    setDetails((prev: any) => ({ ...prev, [field]: value }));
  };

  const isValid = details.companyName && details.contactName && details.contactEmail;

  return (
    <motion.div
      key="company"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-3"
    >
      <button 
        onClick={onBack} 
        className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        data-testid="button-back-company"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </button>

      <div className="text-center mb-2">
        <h2 className="text-lg font-semibold">Company Details</h2>
        <p className="text-sm text-muted-foreground">Tell us about your organization</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Company Name *</label>
          <Input
            placeholder="Acme Inc."
            value={details.companyName}
            onChange={(e) => update("companyName", e.target.value)}
            data-testid="input-company-name"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Name *</label>
          <Input
            placeholder="John Doe"
            value={details.contactName}
            onChange={(e) => update("contactName", e.target.value)}
            data-testid="input-contact-name"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email *</label>
            <Input
              type="email"
              placeholder="john@acme.com"
              value={details.contactEmail}
              onChange={(e) => update("contactEmail", e.target.value)}
              data-testid="input-contact-email"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Phone</label>
            <Input
              type="tel"
              placeholder="98765 43210"
              value={details.contactPhone}
              onChange={(e) => update("contactPhone", e.target.value)}
              data-testid="input-contact-phone"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Use full international number for non-default countries.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Industry</label>
            <Input
              placeholder="Healthcare"
              value={details.industry}
              onChange={(e) => update("industry", e.target.value)}
              data-testid="input-industry"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Team Size</label>
            <Input
              placeholder="10-50"
              value={details.size}
              onChange={(e) => update("size", e.target.value)}
              data-testid="input-size"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Website</label>
          <Input
            placeholder="https://acme.com"
            value={details.website}
            onChange={(e) => update("website", e.target.value)}
            data-testid="input-website"
          />
        </div>
      </div>

      <Button 
        onClick={onContinue} 
        className="w-full mt-2" 
        size="lg"
        disabled={!isValid || isLoading}
        data-testid="button-submit-company"
      >
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Submit Application <ArrowRight className="w-4 h-4 ml-2" /></>}
      </Button>
    </motion.div>
  );
}

function PendingApprovalStep({ companyName }: { companyName: string }) {
  return (
    <motion.div
      key="pending"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center py-6"
    >
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-500/20 flex items-center justify-center">
        <Clock className="w-8 h-8 text-amber-400" />
      </div>
      
      <h2 className="text-xl font-semibold mb-2">Application Submitted!</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Your application for <span className="font-medium text-foreground">{companyName}</span> is pending review.
      </p>
      
      <div className="p-4 rounded-lg bg-muted text-left space-y-2">
        <h3 className="text-sm font-medium">What happens next?</h3>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li className="flex items-start gap-2">
            <Check className="w-3 h-3 mt-1 text-green-400" />
            Our team will review your application within 24 hours
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-3 h-3 mt-1 text-green-400" />
            You'll receive 100 free credits upon approval
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-3 h-3 mt-1 text-green-400" />
            Access to dashboard, API keys, and team management
          </li>
        </ul>
      </div>

      <Button 
        variant="outline" 
        className="mt-4"
        onClick={() => window.location.reload()}
        data-testid="button-back-home"
      >
        Back to Home
      </Button>
    </motion.div>
  );
}


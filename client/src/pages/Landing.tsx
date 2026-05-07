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
  const savedFlow = getSignupFlow();
  const [step, setStepState] = useState<Step>(savedFlow?.step || "choose");
  const [accountType, setAccountType] = useState<AccountType>(savedFlow?.accountType || "consumer");
  
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
        let otpSent = false;

        if (firebaseEnabled && !confirmationResult) {
          setIsSendingFirebaseOtp(true);
          try {
            const verifier = setupRecaptcha("recaptcha-container");
            if (!verifier) {
              throw new Error("Firebase reCAPTCHA could not be initialized");
            }
            
            const result = await sendOtpWithFirebase(normalizedIdentifier);
            if (result) {
              setConfirmationResult(result);
              usedFirebaseFlow = true;
              otpSent = true;
            }
          } catch (err: any) {
            console.error("Firebase OTP error:", err);
            setConfirmationResult(null);
            await requestOtp({ identifier: normalizedIdentifier, channel });
            otpSent = true;
            toast({
              title: "Using SMS fallback",
              description: getFirebasePhoneAuthErrorMessage(err),
            });
          } finally {
            setIsSendingFirebaseOtp(false);
          }
        } else {
          setConfirmationResult(null);
          await requestOtp({ identifier: normalizedIdentifier, channel });
          otpSent = true;
        }

        if (otpSent) {
          setIdentifier(normalizedIdentifier);
          toast({
            title: "OTP Sent",
            description: usedFirebaseFlow
              ? "If the Firebase SMS does not arrive, tap Resend and the app will switch to direct SMS."
              : "Direct SMS OTP sent. Check your phone for the verification code.",
          });
          setStep("otp");
        }
        return;
      } else {
        // Email OTP still uses the server email provider.
        await requestOtp({ identifier: normalizedIdentifier, channel });
        setConfirmationResult(null);
        setIdentifier(normalizedIdentifier);
        toast({ title: "OTP Sent", description: `Check your ${channel} for the verification code` });
        setStep("otp");
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleVerifyOtp = async () => {
    const normalizedIdentifier = normalizeIdentifierByChannel(identifier, channel, phoneCountryCode);

    try {
      // If we used Firebase, verify with Firebase first
      if (confirmationResult) {
        setIsVerifyingFirebaseOtp(true);
        try {
          const idToken = await verifyOtpWithFirebase(confirmationResult, otpCode);
          if (idToken) {
            // Verify with backend using Firebase token
            const result = await verifyOtp({ identifier: normalizedIdentifier, channel, code: otpCode, firebaseToken: idToken });
            handleVerifySuccess(result);
          }
        } catch (err: any) {
          toast({ title: "Invalid OTP", description: "The code you entered is incorrect", variant: "destructive" });
        } finally {
          setIsVerifyingFirebaseOtp(false);
        }
      } else {
        // Use server OTP verification
        const result = await verifyOtp({ identifier: normalizedIdentifier, channel, code: otpCode });
        handleVerifySuccess(result);
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
    <div className="min-h-screen flex flex-col relative overflow-hidden mesh-bg">
      {/* Dynamic Background Orbs */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            opacity: [0.1, 0.2, 0.1],
            x: [0, 50, 0],
            y: [0, -30, 0]
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
          className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/30 rounded-full blur-[120px]" 
        />
        <motion.div 
          animate={{ 
            scale: [1, 1.3, 1],
            opacity: [0.1, 0.15, 0.1],
            x: [0, -40, 0],
            y: [0, 40, 0]
          }}
          transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/30 rounded-full blur-[120px]" 
        />
      </div>

      {/* Invisible reCAPTCHA container for Firebase Phone Auth */}
      <div id="recaptcha-container" ref={recaptchaContainerRef} />

      <header className="w-full py-4 px-4 flex items-center justify-between z-10">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-1" data-testid="link-home">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back to Home</span>
          </Button>
        </Link>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Globe className="w-4 h-4" />
          <span className="hidden sm:inline">Multi-language Support</span>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-10">
          <motion.div 
            className="inline-flex items-center justify-center px-4 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.1] backdrop-blur-md mb-6"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.08)" }}
          >
            <Sparkles className="w-3.5 h-3.5 text-primary mr-2 animate-pulse" />
            <span className="text-[10px] font-bold tracking-[0.2em] text-primary uppercase">Next-Gen Voice AI</span>
          </motion.div>
          <motion.h1 
            className="text-6xl md:text-7xl font-black mb-4 font-display tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60"
            initial={{ opacity: 0, filter: "blur(10px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.8, delay: 0.3 }}
          >
            NeuraTalk
          </motion.h1>
          <motion.p 
            className="text-lg text-muted-foreground/80 max-w-sm mx-auto leading-relaxed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            Real-time multilingual voice communication with <span className="text-white">human-eye emotion</span> awareness.
          </motion.p>
        </div>

        <motion.div 
          className="glass-card p-8 rounded-[2rem] relative z-10 overflow-hidden"
          layout
        >
          <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
            <Volume2 className="w-24 h-24 text-primary" />
          </div>
          <AnimatePresence mode="wait">
            {step === "choose" && (
              <ChooseAccountType 
                accountType={accountType}
                setAccountType={setAccountType}
                onContinue={() => setStep("identifier")}
              />
            )}

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
                  onBack={() => setStep("choose")}
                  onContinue={handleRequestOtp}
                  firebaseEnabled={firebaseEnabled}
                />
                <div className="mt-4 text-center">
                  <button
                    onClick={() => setStep("forgot-password")}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    Forgot password? Reset via OTP
                  </button>
                </div>
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
                <button onClick={() => setStep("choose")} className="flex items-center gap-1 text-sm text-muted-foreground mb-6 hover:text-foreground">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <h2 className="text-2xl font-bold mb-2">Reset Password</h2>
                <p className="text-sm text-muted-foreground mb-6">Enter your email or phone to receive a reset code</p>
                <div className="flex gap-2 mb-4">
                  <button onClick={() => setChannel("email")} className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${channel === "email" ? "bg-primary text-black border-primary" : "border-white/10 hover:border-white/20"}`}>
                    <Mail className="w-4 h-4 inline mr-1" /> Email
                  </button>
                  <button onClick={() => setChannel("mobile")} className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${channel === "mobile" ? "bg-primary text-black border-primary" : "border-white/10 hover:border-white/20"}`}>
                    <Phone className="w-4 h-4 inline mr-1" /> Mobile
                  </button>
                </div>
                {channel === "mobile" ? (
                  <div className="grid grid-cols-[150px_1fr] gap-2 mb-4">
                    <Select value={phoneCountryCode} onValueChange={setPhoneCountryCode}>
                      <SelectTrigger className="bg-white/5 border-white/10">
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
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50"
                    />
                  </div>
                ) : (
                  <input
                    type="email"
                    placeholder="your@email.com"
                    value={identifier}
                    onChange={e => setIdentifier(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm mb-4 focus:outline-none focus:border-primary/50"
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
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm mb-3 text-center text-2xl tracking-widest focus:outline-none focus:border-primary/50"
                />
                <input
                  type="password"
                  placeholder="New password (min 6 chars)"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm mb-4 focus:outline-none focus:border-primary/50"
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
      </motion.div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.8 }}
        className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl w-full px-4"
      >
        <FeatureCard 
          icon={<Globe className="w-6 h-6 text-primary" />}
          title="50+ Languages"
          desc="Real-time translation with ultra-natural localized voice synthesis"
          delay={0.8}
        />
        <FeatureCard 
          icon={<Mic className="w-6 h-6 text-secondary" />}
          title="Linguistic Nuance"
          desc="Sub-200ms response time with perfect dialect preservation"
          delay={0.9}
        />
        <FeatureCard 
          icon={<Shield className="w-6 h-6 text-cyan-400" />}
          title="Secure by Design"
          desc="Enterprise-grade encryption with self-hosted sovereignty"
          delay={1.0}
        />
      </motion.div>
      
      {/* Discreet system access link */}
      <Link href="/sys" className="absolute bottom-4 right-4 text-xs text-muted-foreground/30 hover:text-muted-foreground/50 transition-colors">
        v1.0
      </Link>
      </div>
    </div>
  );
}

function ChooseAccountType({ 
  accountType, 
  setAccountType, 
  onContinue 
}: { 
  accountType: AccountType;
  setAccountType: (t: AccountType) => void;
  onContinue: () => void;
}) {
  return (
    <motion.div
      key="choose"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-4"
    >
      <div className="text-center mb-4">
        <h2 className="text-lg font-semibold">Get Started</h2>
        <p className="text-sm text-muted-foreground">Choose your account type</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setAccountType("consumer")}
          data-testid="button-consumer"
          className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${
            accountType === "consumer" 
              ? "border-primary bg-primary/10" 
              : "border-white/10 hover:border-white/20"
          }`}
        >
          <User className={`w-8 h-8 ${accountType === "consumer" ? "text-primary" : "text-muted-foreground"}`} />
          <span className="text-sm font-medium">Personal</span>
          <span className="text-xs text-muted-foreground">For individuals</span>
        </button>

        <button
          onClick={() => setAccountType("business")}
          data-testid="button-business"
          className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${
            accountType === "business" 
              ? "border-secondary bg-secondary/10" 
              : "border-white/10 hover:border-white/20"
          }`}
        >
          <Building2 className={`w-8 h-8 ${accountType === "business" ? "text-secondary" : "text-muted-foreground"}`} />
          <span className="text-sm font-medium">Business</span>
          <span className="text-xs text-muted-foreground">For teams & enterprises</span>
        </button>
      </div>

      <Button 
        onClick={onContinue} 
        className="w-full mt-4" 
        size="lg"
        data-testid="button-continue-account-type"
      >
        Continue <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    </motion.div>
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
  onBack: () => void;
  onContinue: () => void;
  firebaseEnabled?: boolean;
}) {
  return (
    <motion.div
      key="identifier"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-4"
    >
      <button 
        onClick={onBack} 
        className="flex items-center text-sm text-muted-foreground hover:text-white transition-colors"
        data-testid="button-back-identifier"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back
      </button>

      <div className="text-center mb-4">
        <h2 className="text-lg font-semibold">Verify Your Identity</h2>
        <p className="text-sm text-muted-foreground">We'll send you a one-time code</p>
      </div>

      <div className="flex gap-2 p-1 rounded-lg bg-white/5">
        <button
          onClick={() => { setChannel("email"); setIdentifier(""); }}
          data-testid="button-channel-email"
          className={`flex-1 py-2 px-3 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-all ${
            channel === "email" ? "bg-white/10 text-white" : "text-muted-foreground"
          }`}
        >
          <Mail className="w-4 h-4" /> Email
        </button>
        <button
          onClick={() => { setChannel("mobile"); setIdentifier(""); }}
          data-testid="button-channel-mobile"
          className={`flex-1 py-2 px-3 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-all ${
            channel === "mobile" ? "bg-white/10 text-white" : "text-muted-foreground"
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
          Firebase phone OTP is enabled. If delivery fails, resend will switch to direct SMS OTP.
        </p>
      ) : channel === "mobile" ? (
        <p className="text-xs text-center text-muted-foreground">
          Direct SMS OTP is enabled. The selected country code is applied automatically.
        </p>
      ) : (
        <p className="text-xs text-center text-muted-foreground">
          OTP will be sent to your email
        </p>
      )}

      <Button 
        onClick={onContinue} 
        className="w-full" 
        size="lg"
        disabled={!identifier || isLoading}
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
        className="flex items-center text-sm text-muted-foreground hover:text-white transition-colors"
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
        className="w-full text-sm text-muted-foreground hover:text-white transition-colors"
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
        className="flex items-center text-sm text-muted-foreground hover:text-white transition-colors"
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
        Your application for <span className="font-medium text-white">{companyName}</span> is pending review.
      </p>
      
      <div className="p-4 rounded-lg bg-white/5 text-left space-y-2">
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

function FeatureCard({ icon, title, desc, delay }: { icon: React.ReactNode; title: string; desc: string; delay: number }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      whileHover={{ y: -5, backgroundColor: "rgba(255,255,255,0.08)" }}
      className="p-6 rounded-2xl bg-white/[0.03] border border-white/[0.05] shadow-lg transition-colors group"
    >
      <div className="mb-4 p-3 rounded-xl bg-white/[0.05] w-fit group-hover:scale-110 transition-transform">{icon}</div>
      <h3 className="text-base font-bold mb-2 font-display">{title}</h3>
      <p className="text-sm text-muted-foreground/70 leading-relaxed">{desc}</p>
    </motion.div>
  );
}

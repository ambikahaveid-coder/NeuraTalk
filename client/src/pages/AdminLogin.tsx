import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Shield, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { countries, DEFAULT_COUNTRY_CODE, sanitizePhoneInput, validatePhoneNumber } from "@shared/countries";
import { normalizePhoneForCountry } from "@shared/phone";
import { ConfirmationResult } from "firebase/auth";
import {
  clearRecaptcha,
  getPhoneOtpProvider,
  getFirebasePhoneAuthErrorMessage,
  initializeFirebase,
  sendOtpWithFirebase,
  setupRecaptcha,
  verifyOtpWithFirebase,
} from "@/lib/firebase";

export default function AdminLogin() {
  const [step, setStep] = useState<"identifier" | "otp">("identifier");
  const [phoneCountryCode, setPhoneCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [identifier, setIdentifier] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [firebaseEnabled, setFirebaseEnabled] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [isSendingFirebaseOtp, setIsSendingFirebaseOtp] = useState(false);
  const [isVerifyingFirebaseOtp, setIsVerifyingFirebaseOtp] = useState(false);
  const recaptchaContainerRef = useRef<HTMLDivElement>(null);
  const { requestOtp, verifyOtp, isRequestingOtp, isVerifyingOtp } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  useEffect(() => {
    const initialized = initializeFirebase();
    setFirebaseEnabled(initialized);
    return () => clearRecaptcha();
  }, []);

  const phoneOtpProvider = getPhoneOtpProvider();

  const handleRequestOtp = async () => {
    try {
      const channel = identifier.includes("@") ? "email" : "mobile";
      if (channel === "mobile") {
        const validation = validatePhoneNumber(identifier, phoneCountryCode);
        if (!validation.valid) {
          toast({ title: "Invalid phone number", description: validation.message, variant: "destructive" });
          return;
        }
      }
      const normalizedIdentifier = channel === "mobile" ? normalizePhoneForCountry(identifier, phoneCountryCode) : identifier.trim();

      if (channel === "mobile") {
        // Firebase Phone Auth is the only mobile authentication method — no SMS fallback.
        if (!firebaseEnabled) {
          toast({
            title: "Phone login unavailable",
            description: "Firebase Phone Auth is not configured. Please use email login.",
            variant: "destructive",
          });
          return;
        }

        setIsSendingFirebaseOtp(true);
        try {
          const verifier = setupRecaptcha("admin-recaptcha-container");
          if (!verifier) {
            throw new Error("Firebase reCAPTCHA could not be initialized. Please refresh and try again.");
          }

          const result = await sendOtpWithFirebase(normalizedIdentifier);
          if (!result) {
            throw new Error("Failed to start Firebase phone verification.");
          }

          setConfirmationResult(result);
        } catch (firebaseError) {
          setConfirmationResult(null);
          toast({
            title: "Phone verification failed",
            description: getFirebasePhoneAuthErrorMessage(firebaseError),
            variant: "destructive",
          });
          return;
        } finally {
          setIsSendingFirebaseOtp(false);
        }
      } else {
        setConfirmationResult(null);
        await requestOtp({ identifier: normalizedIdentifier, channel });
      }

      setIdentifier(normalizedIdentifier);
      const deliveryMessage = channel === "mobile"
        ? "Check your phone for the Firebase verification code."
        : "Check your email for the verification code.";
      toast({ title: "Code Sent", description: deliveryMessage });
      setStep("otp");
    } catch (error: any) {
      setConfirmationResult(null);
      toast({
        title: "Error",
        description: error?.message || "Failed to send code",
        variant: "destructive",
      });
    }
  };

  const handleVerifyOtp = async () => {
    try {
      const channel = identifier.includes("@") ? "email" : "mobile";
      const normalizedIdentifier = channel === "mobile" ? normalizePhoneForCountry(identifier, phoneCountryCode) : identifier.trim();
      let result;

      if (channel === "mobile") {
        if (!confirmationResult) {
          toast({ title: "Session expired", description: "Please go back and request a new OTP.", variant: "destructive" });
          return;
        }
        setIsVerifyingFirebaseOtp(true);
        try {
          const idToken = await verifyOtpWithFirebase(confirmationResult, otpCode);
          if (!idToken) {
            throw new Error("Failed to verify Firebase OTP");
          }
          result = await verifyOtp({ identifier: normalizedIdentifier, channel, code: otpCode, firebaseToken: idToken });
        } finally {
          setIsVerifyingFirebaseOtp(false);
        }
      } else {
        result = await verifyOtp({ identifier: normalizedIdentifier, channel, code: otpCode });
      }
      
      if (result.success && result.user?.role === "super_admin") {
        toast({ title: "Welcome", description: "Admin access granted" });
        setLocation("/admin");
      } else if (result.success) {
        toast({ 
          title: "Access Denied", 
          description: "This portal is for administrators only", 
          variant: "destructive" 
        });
      }
    } catch (error: any) {
      toast({
        title: "Invalid Code",
        description: error?.message || "Please try again",
        variant: "destructive",
      });
    }
  };

  const isOtpRequestLoading = isRequestingOtp || isSendingFirebaseOtp;
  const isOtpVerifyLoading = isVerifyingOtp || isVerifyingFirebaseOtp;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div id="admin-recaptcha-container" ref={recaptchaContainerRef} />
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-xl">System Access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "identifier" ? (
            <>
              <div className="space-y-2">
                {!identifier.includes("@") && (
                  <Select value={phoneCountryCode} onValueChange={setPhoneCountryCode}>
                    <SelectTrigger data-testid="select-admin-country">
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
                )}
                <Input
                  data-testid="input-admin-identifier"
                  type="text"
                  placeholder={!identifier.includes("@") ? "Phone number or admin@company.com" : "admin@company.com"}
                  value={identifier}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    if (nextValue.includes("@")) {
                      setIdentifier(nextValue);
                      return;
                    }
                    const selectedCountry = countries.find((country) => country.code === phoneCountryCode);
                    setIdentifier(sanitizePhoneInput(nextValue, selectedCountry?.phoneLength || 15));
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleRequestOtp()}
                />
                {!identifier.includes("@") && (
                  <p className="text-xs text-muted-foreground">
                    {phoneOtpProvider === "firebase"
                      ? "Firebase phone OTP is enabled for this screen. If delivery fails, the flow will fall back to direct SMS."
                      : "Direct SMS OTP is enabled for admin login. The selected country code is applied automatically."}
                  </p>
                )}
              </div>
              <Button 
                data-testid="button-admin-continue"
                className="w-full" 
                onClick={handleRequestOtp}
                disabled={!identifier || isOtpRequestLoading}
              >
                {isOtpRequestLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
                Continue
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Input
                  data-testid="input-admin-otp"
                  type="text"
                  placeholder="Enter verification code"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleVerifyOtp()}
                  maxLength={6}
                  className="text-center text-2xl tracking-widest"
                />
              </div>
              <Button 
                data-testid="button-admin-verify"
                className="w-full" 
                onClick={handleVerifyOtp}
                disabled={otpCode.length !== 6 || isOtpVerifyLoading}
              >
                {isOtpVerifyLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Verify
              </Button>
              <Button 
                variant="ghost" 
                className="w-full" 
                onClick={() => {
                  setConfirmationResult(null);
                  setOtpCode("");
                  setStep("identifier");
                }}
              >
                Back
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

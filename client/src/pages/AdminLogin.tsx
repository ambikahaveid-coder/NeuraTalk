import { useState } from "react";
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

export default function AdminLogin() {
  const [step, setStep] = useState<"identifier" | "otp">("identifier");
  const [phoneCountryCode, setPhoneCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [identifier, setIdentifier] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const { requestOtp, verifyOtp, isRequestingOtp, isVerifyingOtp } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

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
      await requestOtp({ identifier: normalizedIdentifier, channel });
      setIdentifier(normalizedIdentifier);
      toast({ title: "Code Sent", description: "Check your email or phone" });
      setStep("otp");
    } catch {
      toast({ title: "Error", description: "Failed to send code", variant: "destructive" });
    }
  };

  const handleVerifyOtp = async () => {
    try {
      const channel = identifier.includes("@") ? "email" : "mobile";
      const normalizedIdentifier = channel === "mobile" ? normalizePhoneForCountry(identifier, phoneCountryCode) : identifier.trim();
      const result = await verifyOtp({ identifier: normalizedIdentifier, channel, code: otpCode });
      
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
    } catch {
      toast({ title: "Invalid Code", description: "Please try again", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
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
                    The selected country code is applied automatically for admin OTP.
                  </p>
                )}
              </div>
              <Button 
                data-testid="button-admin-continue"
                className="w-full" 
                onClick={handleRequestOtp}
                disabled={!identifier || isRequestingOtp}
              >
                {isRequestingOtp ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
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
                disabled={otpCode.length < 4 || isVerifyingOtp}
              >
                {isVerifyingOtp ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Verify
              </Button>
              <Button 
                variant="ghost" 
                className="w-full" 
                onClick={() => setStep("identifier")}
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

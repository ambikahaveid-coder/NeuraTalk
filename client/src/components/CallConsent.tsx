import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion } from "framer-motion";
import { 
  Phone, 
  Languages, 
  Shield, 
  Mic, 
  Eye,
  CheckCircle2,
  AlertTriangle
} from "lucide-react";

interface CallConsentProps {
  onAccept: (consent: { termsAccepted: boolean; translationConsent: boolean; recordingConsent: boolean }) => void;
  onDecline: () => void;
}

export default function CallConsent({ onAccept, onDecline }: CallConsentProps) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [translationConsent, setTranslationConsent] = useState(false);
  const [recordingConsent, setRecordingConsent] = useState(false);

  const allRequired = termsAccepted && translationConsent;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-2xl mx-auto p-4 relative z-10"
    >
      <Card className="glass-card shadow-2xl border-white/10 overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary via-secondary to-primary animate-gradient-shift" />
        <CardHeader className="text-center pb-2">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center mx-auto mb-6 shadow-xl border border-white/10 backdrop-blur-md">
            <Shield className="w-10 h-10 text-primary" />
          </div>
          <CardTitle className="text-3xl font-display font-bold tracking-tight">Enterprise Compliance Vault</CardTitle>
          <CardDescription className="text-sm font-medium text-muted-foreground uppercase tracking-widest mt-2">
            Regulatory & Privacy Authorization
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
              <Languages className="w-5 h-5 text-cyan-500 mt-0.5" />
              <div>
                <p className="font-medium">Real-Time Translation</p>
                <p className="text-sm text-muted-foreground">
                  Your voice is processed by AI to translate in real-time. 
                  The other person hears your voice in their language.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
              <Mic className="w-5 h-5 text-green-500 mt-0.5" />
              <div>
                <p className="font-medium">Voice Processing</p>
                <p className="text-sm text-muted-foreground">
                  Audio is processed in real-time for translation. 
                  We don't store call content without your explicit consent.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
              <Shield className="w-5 h-5 text-blue-500 mt-0.5" />
              <div>
                <p className="font-medium">Privacy First</p>
                <p className="text-sm text-muted-foreground">
                  All processing uses self-hosted, secure infrastructure. 
                  No third-party telecom services access your calls.
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-white/5 pt-6 space-y-6">
            <div className="p-4 rounded-xl bg-primary/5 border border-primary/10">
              <h4 className="font-display font-bold text-sm flex items-center gap-2 mb-2">
                <Shield className="w-4 h-4 text-primary" />
                Legal Safe-Harbor Disclosure
              </h4>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                By enabling Neura-Talk intelligence, you acknowledge that this service operates under the 
                <strong> Digital Personal Data Protection (DPDP) Act of India</strong> and <strong>GDPR guidelines</strong>. 
                Audio streams are processed via encrypted self-hosted nodes. You are responsible for notifying 
                all parties that the call is being translated by AI.
              </p>
            </div>

            <div className="space-y-4">
              <label className="flex items-start gap-4 cursor-pointer group">
                <Checkbox
                  checked={termsAccepted}
                  onCheckedChange={(checked) => setTermsAccepted(checked === true)}
                  data-testid="checkbox-terms"
                  className="mt-1"
                />
                <div className="text-sm">
                  <span className="font-bold font-display group-hover:text-primary transition-colors">Accept Master Service Agreement</span>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    I agree to the <a href="/terms" className="text-primary hover:underline">Telephony Terms</a> and AI processing guidelines.
                  </p>
                  <Badge variant="outline" className="mt-2 text-[9px] uppercase tracking-tighter border-primary/20 text-primary/70">Required for PSTN</Badge>
                </div>
              </label>

              <label className="flex items-start gap-4 cursor-pointer group">
                <Checkbox
                  checked={translationConsent}
                  onCheckedChange={(checked) => setTranslationConsent(checked === true)}
                  data-testid="checkbox-translation"
                  className="mt-1"
                />
                <div className="text-sm">
                  <span className="font-bold font-display group-hover:text-primary transition-colors">Consent to Synthetic Voice Synthesis</span>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    I authorize the processing of my vocal biometric data for real-time translation and voice cloning.
                  </p>
                  <Badge variant="outline" className="mt-2 text-[9px] uppercase tracking-tighter border-primary/20 text-primary/70">Required for Identity</Badge>
                </div>
              </label>

              <label className="flex items-start gap-4 cursor-pointer group">
                <Checkbox
                  checked={recordingConsent}
                  onCheckedChange={(checked) => setRecordingConsent(checked === true)}
                  data-testid="checkbox-recording"
                  className="mt-1"
                />
                <div className="text-sm">
                  <span className="font-bold font-display group-hover:text-primary transition-colors">Enable QoS Quality Auditing (Optional)</span>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Help improve our self-hosted models by allowing anonymized metadata analysis.
                  </p>
                  <Badge variant="secondary" className="mt-2 text-[9px] uppercase tracking-tighter">Optional for Research</Badge>
                </div>
              </label>
            </div>
          </div>

          {!allRequired && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm">Please accept the required consents to continue</span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={onDecline}
              data-testid="button-decline-consent"
            >
              Not Now
            </Button>
            <Button
              className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600"
              disabled={!allRequired}
              onClick={() => onAccept({ termsAccepted, translationConsent, recordingConsent })}
              data-testid="button-accept-consent"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Accept & Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

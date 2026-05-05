/**
 * PhoneIdentityCard — lets the user verify their number as outbound caller ID
 * and shows SIM call-forwarding instructions so inbound calls reach the app.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import {
  CheckCircle2,
  PhoneCall,
  ShieldCheck,
  Copy,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
} from "lucide-react";

interface CallerIdStatus {
  phone: string | null;
  phoneVerified: boolean;
  inboundNumber: string | null;
  forwardingInstructions: {
    android: string;
    iosInstructions: string;
    disableCode: string;
  } | null;
  msg91Configured: boolean;
}

export default function PhoneIdentityCard() {
  const qc = useQueryClient();
  const [step, setStep] = useState<"idle" | "otp">("idle");
  const [otp, setOtp] = useState("");
  const [showForwarding, setShowForwarding] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const { data, isLoading } = useQuery<CallerIdStatus>({
    queryKey: ["/api/caller-id/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/caller-id/status");
      return res as unknown as CallerIdStatus;
    },
  });

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const requestOtp = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/caller-id/verify/request", {});
    },
    onSuccess: () => {
      setStep("otp");
      showToast(`OTP sent to ${data?.phone}`, true);
    },
    onError: (e: any) => {
      showToast(e?.message || "OTP send cheyyadam fail aindi", false);
    },
  });

  const confirmOtp = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/caller-id/verify/confirm", { otp });
    },
    onSuccess: () => {
      setStep("idle");
      setOtp("");
      showToast("Number ownership verified. Outbound caller identity eligibility updated.", true);
      qc.invalidateQueries({ queryKey: ["/api/caller-id/status"] });
    },
    onError: (e: any) => {
      showToast(e?.message || "OTP incorrect — try again", false);
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => showToast("Copied!", true));
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </CardContent>
      </Card>
    );
  }

  const verified = data?.phoneVerified ?? false;
  const phone = data?.phone;
  const hasInbound = !!data?.inboundNumber;
  const fwd = data?.forwardingInstructions;

  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <PhoneCall className="w-5 h-5 text-blue-600" />
          Phone Identity
          {verified && (
            <Badge className="bg-green-100 text-green-700 border-green-200 gap-1 ml-1">
              <CheckCircle2 className="w-3 h-3" /> Verified
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          {verified
            ? "Your line ownership is verified. Outbound caller identity follows provider and compliance rules."
            : "Verify your line ownership for eligible caller identity and forwarding features."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Toast */}
        {toast && (
          <div
            className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
              toast.ok
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            {toast.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            {toast.msg}
          </div>
        )}

        {/* Phone number display */}
        <div className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
          <ShieldCheck className={`w-5 h-5 ${verified ? "text-green-500" : "text-gray-400"}`} />
          <div className="flex-1">
            <div className="font-medium text-sm">{phone || "No phone number in profile"}</div>
            <div className="text-xs text-gray-500">
              {verified ? "Line ownership verified" : "Not verified yet"}
            </div>
          </div>
        </div>

        {/* Verification flow */}
        {!verified && phone && (
          <>
            {step === "idle" ? (
              <Button
                className="w-full gap-2"
                onClick={() => requestOtp.mutate()}
                disabled={requestOtp.isPending || !data?.msg91Configured}
              >
                {requestOtp.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                {data?.msg91Configured
                  ? "Send OTP to verify my number"
                  : "MSG91 not configured (set MSG91_AUTH_KEY)"}
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-600">
                  {phone} ki OTP vachindi — enter cheyyi:
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter OTP"
                    value={otp}
                    onChange={e => setOtp(e.target.value)}
                    maxLength={6}
                    className="text-center text-lg tracking-widest font-mono"
                    onKeyDown={e => { if (e.key === "Enter" && otp.length >= 4) confirmOtp.mutate(); }}
                  />
                  <Button
                    onClick={() => confirmOtp.mutate()}
                    disabled={confirmOtp.isPending || otp.length < 4}
                  >
                    {confirmOtp.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
                  </Button>
                </div>
                <button
                  className="text-xs text-blue-600 underline"
                  onClick={() => { setStep("idle"); setOtp(""); }}
                >
                  Resend OTP
                </button>
              </div>
            )}
          </>
        )}

        {!phone && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Profile → Settings lo phone number add cheyyi, tharwata verify cheyyachu.
          </p>
        )}

        {/* Call forwarding section */}
        {verified && hasInbound && fwd && (
          <div className="border rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-3 py-2 bg-blue-50 hover:bg-blue-100 text-sm font-medium text-blue-800"
              onClick={() => setShowForwarding(v => !v)}
            >
              <span>Friend calls you → App lo receive cheyyali? Set up forwarding</span>
              {showForwarding ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showForwarding && (
              <div className="px-3 py-3 space-y-3 text-sm">
                <p className="text-gray-600 text-xs">
                  Friend meeru number ki call chesthadu → Meeru 30s lo pick up cheyakapothey → NeuraTalk ki forward → App lo translation tho receive chesthaamu.
                  <br />
                  <strong>One-time setup only.</strong>
                </p>

                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-1">Android — Dialpad lo type cheyyi:</p>
                  <div className="flex items-center gap-2 bg-gray-900 text-green-400 font-mono text-sm rounded px-3 py-2">
                    <span className="flex-1 select-all">{fwd.android}</span>
                    <button onClick={() => copyToClipboard(fwd.android)} title="Copy">
                      <Copy className="w-4 h-4 text-gray-400 hover:text-white" />
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-1">iPhone:</p>
                  <p className="text-xs text-gray-600 bg-gray-50 rounded px-3 py-2">
                    {fwd.iosInstructions}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-1">Disable forwarding (normal calls back):</p>
                  <div className="flex items-center gap-2 bg-gray-100 font-mono text-sm rounded px-3 py-2">
                    <span className="flex-1">{fwd.disableCode}</span>
                    <button onClick={() => copyToClipboard(fwd.disableCode)} title="Copy">
                      <Copy className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* If verified but inbound number not configured yet */}
        {verified && !hasInbound && (
          <p className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2">
            Inbound calling: set <code className="font-mono">NEURATALK_INBOUND_NUMBER</code> env var (MSG91 inbound number) to enable forwarding.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

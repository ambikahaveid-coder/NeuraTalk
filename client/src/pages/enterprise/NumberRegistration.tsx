import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Phone, ChevronLeft, ChevronRight, CheckCircle2,
  Wifi, GitMerge, Cloud, PhoneForwarded, Bot, Webhook, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "Request failed");
  return json.data;
}

// ── Integration type definitions ──────────────────────────────────────────────

const INTEGRATION_TYPES = [
  {
    value: "sip_trunk",
    label: "SIP Trunk",
    icon: Wifi,
    description: "Connect via SIP protocol — works with Asterisk, FreePBX, 3CX, Avaya",
    badge: "Most Popular",
    badgeColor: "bg-blue-100 text-blue-800",
  },
  {
    value: "call_forwarding",
    label: "Call Forwarding",
    icon: PhoneForwarded,
    description: "Forward calls from your existing number to NeuraTalk — simplest setup",
    badge: "Easiest",
    badgeColor: "bg-green-100 text-green-800",
  },
  {
    value: "cloud_pbx",
    label: "Cloud PBX",
    icon: Cloud,
    description: "Integrate with cloud PBX platforms (RingCentral, Vonage, Zoom Phone)",
    badge: null,
    badgeColor: "",
  },
  {
    value: "ivr",
    label: "IVR Integration",
    icon: GitMerge,
    description: "Connect existing IVR menus — NeuraTalk adds AI layer between IVR and agents",
    badge: null,
    badgeColor: "",
  },
  {
    value: "contact_center",
    label: "Contact Center",
    icon: Building2,
    description: "Full contact center integration — skill routing, agent assist, quality monitoring",
    badge: "Enterprise",
    badgeColor: "bg-purple-100 text-purple-800",
  },
  {
    value: "api_based",
    label: "API Based",
    icon: Bot,
    description: "Custom API integration — your system triggers NeuraTalk via REST API",
    badge: null,
    badgeColor: "",
  },
  {
    value: "webhook_based",
    label: "Webhook Based",
    icon: Webhook,
    description: "NeuraTalk sends events to your webhook — event-driven integration",
    badge: null,
    badgeColor: "",
  },
];

const CARRIERS = [
  { value: "airtel", label: "Airtel" },
  { value: "jio", label: "Jio" },
  { value: "vi", label: "Vi (Vodafone Idea)" },
  { value: "bsnl", label: "BSNL" },
  { value: "sip", label: "SIP Provider" },
  { value: "did", label: "DID Provider" },
  { value: "tollfree", label: "Toll-Free" },
  { value: "international", label: "International" },
  { value: "unknown", label: "Other / Unknown" },
];

// ── Step components ───────────────────────────────────────────────────────────

function Step1SelectType({ selected, onSelect }: { selected: string; onSelect: (v: string) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Choose Integration Type</h2>
        <p className="text-sm text-muted-foreground mt-1">How do you want to connect your existing number to NeuraTalk?</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {INTEGRATION_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => onSelect(t.value)}
            className={`text-left p-4 rounded-xl border-2 transition-all ${selected === t.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
          >
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${selected === t.value ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <t.icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{t.label}</span>
                  {t.badge && <span className={`text-xs px-1.5 py-0.5 rounded-full ${t.badgeColor}`}>{t.badge}</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Step2NumberDetails({
  form,
  onChange,
}: {
  form: Record<string, string>;
  onChange: (k: string, v: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Number Details</h2>
        <p className="text-sm text-muted-foreground mt-1">Enter your existing business number and its details</p>
      </div>

      <div>
        <Label>Phone Number <span className="text-destructive">*</span></Label>
        <Input
          className="mt-1"
          placeholder="+911800XXXXXX or 0120XXXXXXX"
          value={form.phoneNumber}
          onChange={(e) => onChange("phoneNumber", e.target.value)}
        />
        <p className="text-xs text-muted-foreground mt-1">Enter in E.164 format (+91...) or local format — we'll normalize it</p>
      </div>

      <div>
        <Label>Label / Name</Label>
        <Input
          className="mt-1"
          placeholder="e.g. Sales Hotline, Customer Support"
          value={form.label}
          onChange={(e) => onChange("label", e.target.value)}
        />
      </div>

      <div>
        <Label>Carrier / Provider <span className="text-destructive">*</span></Label>
        <Select value={form.carrier} onValueChange={(v) => onChange("carrier", v)}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="Select carrier..." /></SelectTrigger>
          <SelectContent>
            {CARRIERS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Country</Label>
        <Select value={form.countryCode} onValueChange={(v) => onChange("countryCode", v)}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="IN">India</SelectItem>
            <SelectItem value="US">United States</SelectItem>
            <SelectItem value="GB">United Kingdom</SelectItem>
            <SelectItem value="SG">Singapore</SelectItem>
            <SelectItem value="AE">UAE</SelectItem>
            <SelectItem value="AU">Australia</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {form.integrationType === "call_forwarding" && (
        <div>
          <Label>Forwarding Target Number</Label>
          <Input
            className="mt-1"
            placeholder="NeuraTalk will provide this after registration"
            value={form.forwardingTarget}
            onChange={(e) => onChange("forwardingTarget", e.target.value)}
            disabled
          />
          <p className="text-xs text-muted-foreground mt-1">A NeuraTalk number will be assigned after registration — configure forwarding to it</p>
        </div>
      )}

      {form.integrationType === "webhook_based" && (
        <div>
          <Label>Webhook URL</Label>
          <Input
            className="mt-1"
            placeholder="https://your-server.com/neuratalk-events"
            value={form.webhookUrl}
            onChange={(e) => onChange("webhookUrl", e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

function Step3Confirm({ form }: { form: Record<string, string> }) {
  const intType = INTEGRATION_TYPES.find((t) => t.value === form.integrationType);
  const carrier = CARRIERS.find((c) => c.value === form.carrier);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Confirm & Register</h2>
        <p className="text-sm text-muted-foreground mt-1">Review your number details before registering</p>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Phone Number</span>
            <span className="font-medium">{form.phoneNumber}</span>
          </div>
          {form.label && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Label</span>
              <span className="font-medium">{form.label}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Carrier</span>
            <span className="font-medium">{carrier?.label ?? form.carrier}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Integration Type</span>
            <span className="font-medium">{intType?.label ?? form.integrationType}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Country</span>
            <span className="font-medium">{form.countryCode}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-4">
          <p className="text-sm text-blue-800 font-medium">What happens next?</p>
          <ul className="mt-2 space-y-1 text-sm text-blue-700">
            <li>• Number will be registered in pending state</li>
            <li>• You'll be asked to verify ownership via OTP or callback</li>
            <li>• Once verified, the number becomes active</li>
            <li>• Configure AI services from the AI Control tab</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Registration Flow ────────────────────────────────────────────────────

export default function NumberRegistration() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Record<string, string>>({
    integrationType: "",
    phoneNumber: "",
    label: "",
    carrier: "unknown",
    countryCode: "IN",
    forwardingTarget: "",
    webhookUrl: "",
  });

  const updateForm = (k: string, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  const registerMutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      apiFetch("/api/enterprise-hub/numbers", {
        method: "POST",
        body: JSON.stringify({
          phoneNumber: data.phoneNumber,
          label: data.label || undefined,
          carrier: data.carrier,
          integrationType: data.integrationType,
          countryCode: data.countryCode,
          forwardingTarget: data.forwardingTarget || undefined,
          webhookUrl: data.webhookUrl || undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/enterprise-hub/numbers"] });
      qc.invalidateQueries({ queryKey: ["/api/enterprise-hub/overview"] });
      toast({ title: "Number registered!", description: "Go to Numbers tab to verify ownership." });
      navigate("/enterprise/hub");
    },
    onError: (e: any) => toast({ title: "Registration failed", description: e.message, variant: "destructive" }),
  });

  const canProceedStep1 = !!form.integrationType;
  const canProceedStep2 = !!form.phoneNumber && !!form.carrier;

  const STEPS = [
    { n: 1, label: "Integration Type" },
    { n: 2, label: "Number Details" },
    { n: 3, label: "Confirm" },
  ];

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="sm" onClick={() => navigate("/enterprise/hub")}>
          <ChevronLeft className="h-4 w-4 mr-1" />Back
        </Button>
        <div>
          <h1 className="text-xl font-bold">Register Existing Number</h1>
          <p className="text-sm text-muted-foreground">Connect your business number to NeuraTalk AI</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={s.n} className="flex items-center gap-2">
            <div className={`flex items-center gap-2 ${step === s.n ? "text-primary" : step > s.n ? "text-green-600" : "text-muted-foreground"}`}>
              <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${step === s.n ? "border-primary bg-primary text-primary-foreground" : step > s.n ? "border-green-600 bg-green-600 text-white" : "border-muted-foreground"}`}>
                {step > s.n ? <CheckCircle2 className="h-4 w-4" /> : s.n}
              </div>
              <span className="text-xs font-medium hidden sm:block">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <div className={`flex-1 h-px w-8 ${step > s.n ? "bg-green-600" : "bg-border"}`} />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <Card>
        <CardContent className="pt-6 pb-6">
          {step === 1 && <Step1SelectType selected={form.integrationType} onSelect={(v) => updateForm("integrationType", v)} />}
          {step === 2 && <Step2NumberDetails form={form} onChange={updateForm} />}
          {step === 3 && <Step3Confirm form={form} />}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <Button variant="ghost" onClick={() => (step > 1 ? setStep(step - 1) : navigate("/enterprise/hub"))}>
          <ChevronLeft className="h-4 w-4 mr-1" />{step === 1 ? "Cancel" : "Back"}
        </Button>
        {step < 3 ? (
          <Button
            onClick={() => setStep(step + 1)}
            disabled={(step === 1 && !canProceedStep1) || (step === 2 && !canProceedStep2)}
          >
            Next<ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button
            onClick={() => registerMutation.mutate(form)}
            disabled={registerMutation.isPending}
          >
            {registerMutation.isPending ? "Registering..." : "Register Number"}
          </Button>
        )}
      </div>
    </div>
  );
}

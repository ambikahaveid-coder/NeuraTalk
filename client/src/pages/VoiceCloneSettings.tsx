import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mic, Trash2, ArrowLeft, ShieldCheck, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { getAuthToken, useAuth } from "@/hooks/use-auth";

function apiFetch(path: string, opts?: RequestInit) {
  const token = getAuthToken();
  return fetch(path, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts?.headers ?? {}) },
  }).then(async (r) => {
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Request failed");
    return j;
  });
}

interface VoiceProfileStatus {
  hasCustomVoice: boolean;
  profile?: {
    id: number;
    name: string;
    isEnabled: boolean;
    trainingStatus: string; // pending | training | ready | pending_gpu | failed
    createdAt: string;
  };
  sampleCount?: number;
}

const STATUS_COPY: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  training: { label: "Training…", variant: "secondary" },
  pending_gpu: { label: "Waiting on voice cloning provider", variant: "secondary" },
  failed: { label: "Training failed", variant: "destructive" },
  pending: { label: "Not started", variant: "outline" },
};

const CONSENT_TEXT =
  "I confirm this is my own voice, I am recording these samples voluntarily, and I consent to NeuraTalk using them to create a personal AI voice clone for my use in translated calls. My samples will be encrypted and I can delete them at any time. A NeuraTalk reviewer approves each voice clone before it can be used in a real call.";

const MIN_SAMPLES = 3;

export default function VoiceCloneSettings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [consented, setConsented] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");

  const userId = user?.id;

  const { data, isLoading } = useQuery<VoiceProfileStatus>({
    queryKey: ["/api/voice-training/profile", userId],
    queryFn: () => apiFetch(`/api/voice-training/profile/${userId}`),
    enabled: !!userId,
    refetchInterval: (query) => {
      const status = query.state.data?.profile?.trainingStatus;
      return status === "training" ? 5000 : false;
    },
  });

  async function submitEnrollment() {
    if (files.length < MIN_SAMPLES) return toast({ title: `At least ${MIN_SAMPLES} voice samples are required`, variant: "destructive" });
    if (!consented) return toast({ title: "Consent is required to enroll a voice", variant: "destructive" });
    if (!userId) return;

    setSubmitting(true);
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress(`Uploading sample ${i + 1} of ${files.length}…`);
        const file = files[i];

        const { uploadURL, objectPath } = await apiFetch("/api/voice-training/request-upload", {
          method: "POST",
          body: JSON.stringify({ consent: true }),
        });

        const putRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type || "audio/wav" } });
        if (!putRes.ok) throw new Error(`Upload failed for sample ${i + 1}`);

        await apiFetch("/api/voice-training/samples", {
          method: "POST",
          body: JSON.stringify({
            objectPath,
            consent: true,
            metadata: { originalName: file.name, mimeType: file.type, sizeBytes: file.size },
          }),
        });
      }

      setProgress("Starting training…");
      await apiFetch(`/api/voice-training/train/${userId}`, { method: "POST" });

      toast({ title: "Voice submitted for training", description: "This takes a few minutes, then a reviewer approves it before use in calls." });
      setFiles([]);
      setConsented(false);
      qc.invalidateQueries({ queryKey: ["/api/voice-training/profile", userId] });
    } catch (e: unknown) {
      toast({ title: "Enrollment failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
      setProgress("");
    }
  }

  async function deleteAllVoiceData() {
    if (!userId) return;
    if (!confirm("Delete all your voice samples and clone data? This cannot be undone.")) return;
    try {
      await apiFetch(`/api/voice-training/delete-all/${userId}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmDelete: true }),
      });
      toast({ title: "Voice data deleted" });
      qc.invalidateQueries({ queryKey: ["/api/voice-training/profile", userId] });
    } catch (e: unknown) {
      toast({ title: "Delete failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function toggleEnabled(enabled: boolean) {
    if (!userId) return;
    try {
      await apiFetch(`/api/voice-training/profile/${userId}/toggle`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      qc.invalidateQueries({ queryKey: ["/api/voice-training/profile", userId] });
    } catch (e: unknown) {
      toast({ title: "Could not update", description: (e as Error).message, variant: "destructive" });
    }
  }

  const profile = data?.profile;
  const readyForCalls = profile?.trainingStatus === "ready" && profile?.isEnabled;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Mic className="h-6 w-6 text-primary" />Personal AI Voice Clone</h1>
            <p className="text-muted-foreground text-sm">Enroll your voice so translated calls sound like you, not a generic TTS voice.</p>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : data?.hasCustomVoice && profile ? (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{profile.name}</CardTitle>
                <Badge variant={readyForCalls ? "default" : (STATUS_COPY[profile.trainingStatus]?.variant ?? "outline")}>
                  {readyForCalls ? "Active" : STATUS_COPY[profile.trainingStatus]?.label ?? profile.trainingStatus}
                </Badge>
              </div>
              <CardDescription>
                {profile.trainingStatus === "ready" && !profile.isEnabled && "Waiting for admin review before this can be used in calls."}
                {profile.trainingStatus === "ready" && profile.isEnabled && "This voice is approved and will be used in your translated calls."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              {profile.trainingStatus === "ready" && (
                <Button size="sm" variant="outline" onClick={() => toggleEnabled(!profile.isEnabled)}>
                  {profile.isEnabled ? "Disable" : "Enable"}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={deleteAllVoiceData}>
                <Trash2 className="h-4 w-4 mr-1 text-destructive" />Delete all voice data
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Enroll your voice</CardTitle>
              <CardDescription>Upload at least {MIN_SAMPLES} clear recordings of yourself speaking (no background noise, a few sentences each).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Voice samples ({MIN_SAMPLES}+ audio files)</Label>
                <Input type="file" accept="audio/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
                {files.length > 0 && <p className="text-xs text-muted-foreground mt-1">{files.length} file(s) selected</p>}
              </div>
              <div className="flex items-start gap-2 rounded-md border p-3 bg-muted/30">
                <Checkbox checked={consented} onCheckedChange={(v) => setConsented(v === true)} id="voice-consent" className="mt-0.5" />
                <Label htmlFor="voice-consent" className="text-xs leading-relaxed font-normal">{CONSENT_TEXT}</Label>
              </div>
              <Button onClick={submitEnrollment} disabled={submitting} className="w-full">
                {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{progress || "Submitting…"}</> : "Submit for enrollment"}
              </Button>
              <p className="text-xs text-muted-foreground flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />Samples are encrypted; a reviewer approves your clone before it's used in a real call.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

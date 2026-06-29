/**
 * Azure Cognitive Services STT Provider
 *
 * Best for: real-time streaming, Indian languages (hi-IN, te-IN, ta-IN, etc.),
 * speaker diarization, custom acoustic models.
 * Cost: ~$1/hr continuous recognition.
 */

import { logger } from "../../observability";
import type { ISTTProvider, STTRequest, STTResult, AIProviderHealth } from "../types";

function azureKey(): string | undefined {
  return process.env.AZURE_SPEECH_KEY?.trim();
}

function azureRegion(): string {
  return process.env.AZURE_SPEECH_REGION?.trim() || "eastus";
}

// Map our lang codes to Azure locale format
const LOCALE_MAP: Record<string, string> = {
  hi: "hi-IN", te: "te-IN", ta: "ta-IN", kn: "kn-IN", ml: "ml-IN",
  mr: "mr-IN", gu: "gu-IN", pa: "pa-IN", bn: "bn-IN",
  en: "en-IN", "en-IN": "en-IN", fr: "fr-FR", de: "de-DE",
  es: "es-ES", ar: "ar-AE", zh: "zh-CN", ja: "ja-JP", ko: "ko-KR",
};

export class AzureSTTProvider implements ISTTProvider {
  readonly name = "azure" as const;

  isAvailable(): boolean {
    return Boolean(azureKey());
  }

  async transcribe(req: STTRequest): Promise<STTResult> {
    const start = Date.now();
    const key = azureKey();
    if (!key) throw new Error("AZURE_SPEECH_KEY not configured");

    const locale = LOCALE_MAP[req.language || "en-IN"] || "en-IN";
    const endpoint = `https://${azureRegion()}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`;

    const params = new URLSearchParams({
      language: locale,
      format: "detailed",
      profanity: req.profanityFilter ? "masked" : "raw",
    });

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30_000);

    try {
      const res = await fetch(`${endpoint}?${params.toString()}`, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": req.mimeType === "audio/wav" ? "audio/wav" : "audio/ogg; codecs=opus",
          Accept: "application/json",
        },
        body: req.audio,
        signal: ac.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Azure STT HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      const latencyMs = Date.now() - start;
      const best = data.NBest?.[0] || {};

      return {
        transcript: data.DisplayText || best.Display || "",
        confidence: best.Confidence || 0.8,
        language: (req.language || "en-IN") as any,
        durationSeconds: (data.Duration || 0) / 10_000_000,
        words: (best.Words || []).map((w: any) => ({
          word: w.Word || "",
          startMs: Math.round((w.Offset || 0) / 10_000),
          endMs: Math.round(((w.Offset || 0) + (w.Duration || 0)) / 10_000),
          confidence: w.Confidence || 0.8,
        })),
        provider: this.name,
        latencyMs,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(): Promise<AIProviderHealth> {
    if (!this.isAvailable()) {
      return { provider: this.name, healthy: false, message: "AZURE_SPEECH_KEY not configured" };
    }
    const start = Date.now();
    try {
      const res = await fetch(
        `https://${azureRegion()}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`,
        {
          method: "POST",
          headers: { "Ocp-Apim-Subscription-Key": azureKey()! },
        },
      );
      return { provider: this.name, healthy: res.ok, latencyMs: Date.now() - start, message: res.ok ? "OK" : `HTTP ${res.status}` };
    } catch (err) {
      return { provider: this.name, healthy: false, latencyMs: Date.now() - start, message: String(err) };
    }
  }
}

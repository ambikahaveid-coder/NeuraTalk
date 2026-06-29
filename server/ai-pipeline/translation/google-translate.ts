/**
 * Google Cloud Translation Provider
 *
 * Supports 130+ languages including all major Indian languages.
 * Best for: real-time call translation, production use.
 * Cost: $20/1M chars.
 *
 * env: GOOGLE_TRANSLATE_API_KEY or GOOGLE_APPLICATION_CREDENTIALS (service account)
 */

import { logger } from "../../observability";
import type { ITranslationProvider, TranslationRequest, TranslationResult, AIProviderHealth, SupportedLanguage } from "../types";

function apiKey(): string | undefined {
  return process.env.GOOGLE_TRANSLATE_API_KEY?.trim();
}

const SUPPORTED_PAIRS: Array<{ from: SupportedLanguage | "auto"; to: SupportedLanguage }> = [
  { from: "auto", to: "en" }, { from: "auto", to: "hi" }, { from: "auto", to: "te" },
  { from: "hi", to: "en" }, { from: "te", to: "en" }, { from: "ta", to: "en" },
  { from: "kn", to: "en" }, { from: "ml", to: "en" }, { from: "mr", to: "en" },
  { from: "en", to: "hi" }, { from: "en", to: "te" }, { from: "en", to: "ta" },
  { from: "en", to: "kn" }, { from: "en", to: "ml" }, { from: "en", to: "mr" },
];

export class GoogleTranslateProvider implements ITranslationProvider {
  readonly name = "google" as const;

  isAvailable(): boolean {
    return Boolean(apiKey());
  }

  getSupportedPairs() {
    return SUPPORTED_PAIRS;
  }

  async translate(req: TranslationRequest): Promise<TranslationResult> {
    const start = Date.now();
    const key = apiKey();
    if (!key) throw new Error("GOOGLE_TRANSLATE_API_KEY not configured");

    const body: Record<string, unknown> = {
      q: req.text,
      target: req.toLanguage.split("-")[0],
      format: "text",
    };
    if (req.fromLanguage !== "auto") {
      body.source = req.fromLanguage.split("-")[0];
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10_000);

    try {
      const res = await fetch(
        `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ac.signal,
        },
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Google Translate HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      const translation = data.data?.translations?.[0];
      const latencyMs = Date.now() - start;

      return {
        translatedText: translation?.translatedText || "",
        detectedLanguage: translation?.detectedSourceLanguage as SupportedLanguage | undefined,
        confidence: 0.95,
        provider: this.name,
        latencyMs,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(): Promise<AIProviderHealth> {
    if (!this.isAvailable()) {
      return { provider: this.name, healthy: false, message: "GOOGLE_TRANSLATE_API_KEY not configured" };
    }
    const start = Date.now();
    try {
      const result = await this.translate({ text: "hello", fromLanguage: "en", toLanguage: "hi" });
      return { provider: this.name, healthy: Boolean(result.translatedText), latencyMs: Date.now() - start, message: "OK" };
    } catch (err) {
      return { provider: this.name, healthy: false, latencyMs: Date.now() - start, message: String(err) };
    }
  }
}

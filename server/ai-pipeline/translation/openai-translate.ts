/**
 * OpenAI GPT Translation Provider
 *
 * Uses GPT-4o for context-aware translation.
 * Best for: domain-specific translation (medical, legal, technical),
 * low-volume high-quality needs, fallback when Google is unavailable.
 * Cost: ~$0.01/1K tokens.
 */

import OpenAI from "openai";
import { getOpenAIKey, hasWorkingOpenAIKey } from "../../openai-config";
import { logger } from "../../observability";
import type { ITranslationProvider, TranslationRequest, TranslationResult, AIProviderHealth, SupportedLanguage } from "../types";

const LANG_NAMES: Record<string, string> = {
  hi: "Hindi", te: "Telugu", ta: "Tamil", kn: "Kannada", ml: "Malayalam",
  mr: "Marathi", gu: "Gujarati", pa: "Punjabi", bn: "Bengali", or: "Odia",
  en: "English", "en-IN": "Indian English", fr: "French", de: "German",
  es: "Spanish", ar: "Arabic", zh: "Chinese", ja: "Japanese", ko: "Korean",
};

export class OpenAITranslateProvider implements ITranslationProvider {
  readonly name = "openai" as const;

  private client(): OpenAI {
    return new OpenAI({ apiKey: getOpenAIKey() || "" });
  }

  isAvailable(): boolean {
    return hasWorkingOpenAIKey();
  }

  getSupportedPairs() {
    return [];
  }

  async translate(req: TranslationRequest): Promise<TranslationResult> {
    const start = Date.now();
    const toLang = LANG_NAMES[req.toLanguage] || req.toLanguage;
    const fromLang = req.fromLanguage === "auto" ? "auto-detected language" : (LANG_NAMES[req.fromLanguage] || req.fromLanguage);
    const domainHint = req.domain && req.domain !== "general"
      ? ` This is a ${req.domain} domain conversation.`
      : "";

    const completion = await this.client().chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 2048,
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Translate from ${fromLang} to ${toLang}.${domainHint} Output ONLY the translated text, nothing else. Preserve tone, register, and formatting.`,
        },
        { role: "user", content: req.text },
      ],
    });

    const latencyMs = Date.now() - start;
    const translatedText = completion.choices[0]?.message?.content?.trim() || "";

    return {
      translatedText,
      confidence: 0.9,
      provider: this.name,
      latencyMs,
    };
  }

  async healthCheck(): Promise<AIProviderHealth> {
    return {
      provider: this.name,
      healthy: this.isAvailable(),
      message: this.isAvailable() ? "OK" : "OPENAI_API_KEY not configured",
    };
  }
}

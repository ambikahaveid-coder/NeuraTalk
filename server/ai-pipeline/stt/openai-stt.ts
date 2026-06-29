/**
 * OpenAI Whisper STT Provider
 *
 * Wraps Whisper large-v2 via OpenAI API.
 * Best for: multilingual, high accuracy, async batch transcription.
 * Cost: ~$0.006/min.
 */

import { toFile } from "openai";
import { getOpenAIKey, hasWorkingOpenAIKey } from "../../openai-config";
import { logger } from "../../observability";
import type { ISTTProvider, STTRequest, STTResult, AIProviderHealth } from "../types";
import OpenAI from "openai";

export class OpenAISTTProvider implements ISTTProvider {
  readonly name = "openai" as const;

  private client(): OpenAI {
    return new OpenAI({ apiKey: getOpenAIKey() || "" });
  }

  isAvailable(): boolean {
    return hasWorkingOpenAIKey();
  }

  async transcribe(req: STTRequest): Promise<STTResult> {
    const start = Date.now();
    const ext = req.mimeType.split("/")[1] || "wav";
    const filename = `audio.${ext}`;
    const file = await toFile(req.audio, filename, { type: req.mimeType });

    const params: OpenAI.Audio.TranscriptionCreateParamsNonStreaming = {
      model: "whisper-1",
      file,
      response_format: "verbose_json",
    };
    if (req.language && req.language !== "en") {
      params.language = req.language.split("-")[0];
    }

    const result = await this.client().audio.transcriptions.create(params);
    const latencyMs = Date.now() - start;

    return {
      transcript: result.text || "",
      confidence: 0.9,
      language: ((result as any).language as any) || req.language || null,
      durationSeconds: (result as any).duration || 0,
      provider: this.name,
      latencyMs,
    };
  }

  async healthCheck(): Promise<AIProviderHealth> {
    const available = this.isAvailable();
    return {
      provider: this.name,
      healthy: available,
      message: available ? "OK" : "OPENAI_API_KEY not configured",
    };
  }
}

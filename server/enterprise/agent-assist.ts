/**
 * Enterprise Agent Assist Engine
 *
 * Real-time AI coaching for call center agents:
 *   - Listens to live transcript events from RTP AI worker
 *   - Generates context-aware response suggestions
 *   - Detects escalation triggers (anger, repeat complaint, legal threat)
 *   - Pushes suggestions to agent desktop via Redis pub/sub → WebSocket
 *
 * Redis channel: agent_assist:{organizationId}:{agentId}
 */

import OpenAI from "openai";
import { getOpenAIKey, hasWorkingOpenAIKey } from "../openai-config";
import { logger } from "../observability";
import { getRedisClient } from "../redis";
import { appendTranscript } from "./session-store";
import type { AgentAssistEvent, AgentSuggestion, EnterpriseCallSession } from "./types";
import type { LiveTranscriptEvent } from "../ai-pipeline/rtp-worker";

const ESCALATION_KEYWORDS = [
  "cancel", "refund", "manager", "supervisor", "lawsuit", "legal",
  "fraud", "cheating", "terrible", "worst", "complaint", "consumer court",
];

export async function processLiveTranscript(
  session: EnterpriseCallSession,
  event: LiveTranscriptEvent,
): Promise<void> {
  const speaker = event.direction === "inbound" ? "customer" : "agent";

  // Append to session transcript
  await appendTranscript(session.callId, {
    speaker,
    text: event.transcript,
    translatedText: event.translation,
    timestampMs: event.timestampMs,
  });

  // Only run agent assist on customer utterances
  if (speaker !== "customer" || !session.aiFeatures.includes("agent_assist")) return;
  if (!session.agentId) return;

  try {
    const assist = await generateAssist(session, event.transcript, event.translation);
    if (!assist) return;
    await publishAssist(session.organizationId, session.agentId, assist);
  } catch (err) {
    logger.warn("AgentAssist", `Failed for ${session.callId}: ${err}`);
  }
}

async function generateAssist(
  session: EnterpriseCallSession,
  customerText: string,
  translatedText?: string,
): Promise<AgentAssistEvent | null> {
  if (!hasWorkingOpenAIKey()) return null;

  const client = new OpenAI({ apiKey: getOpenAIKey() || "" });

  // Build context from last 5 utterances
  const recentContext = session.transcript
    .slice(-10)
    .map((u) => `${u.speaker.toUpperCase()}: ${u.text}`)
    .join("\n");

  const escalationDetected = ESCALATION_KEYWORDS.some((kw) =>
    customerText.toLowerCase().includes(kw) || (translatedText || "").toLowerCase().includes(kw),
  );

  const systemPrompt = `You are an AI assistant helping a call center agent. Based on the conversation context, provide 2-3 concise response suggestions for the agent. Respond ONLY with valid JSON:
{
  "suggestions": [
    {"text": "response text", "confidence": 0.9, "category": "response|info|escalation|offer|close", "source": "llm"},
    ...
  ],
  "escalationRecommended": false,
  "sentiment": "positive|negative|neutral|mixed"
}`;

  const userPrompt = `Recent conversation:\n${recentContext}\n\nLatest customer message: "${customerText}"${translatedText ? `\nTranslation: "${translatedText}"` : ""}${escalationDetected ? "\n⚠️ Escalation keyword detected." : ""}`;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    max_tokens: 512,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  let parsed: any = {};
  try {
    parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    return null;
  }

  const suggestions: AgentSuggestion[] = (parsed.suggestions || []).map((s: any, i: number) => ({
    id: `sug_${session.callId}_${Date.now()}_${i}`,
    text: s.text || "",
    confidence: s.confidence || 0.7,
    category: s.category || "response",
    source: s.source || "llm",
  }));

  if (suggestions.length === 0) return null;

  return {
    callId: session.callId,
    organizationId: session.organizationId,
    agentId: session.agentId!,
    trigger: escalationDetected ? "sentiment_drop" : "customer_utterance",
    customerTranscript: customerText,
    suggestions,
    sentiment: parsed.sentiment || "neutral",
    escalationRecommended: parsed.escalationRecommended || escalationDetected,
    timestampMs: Date.now(),
  };
}

async function publishAssist(orgId: string, agentId: string, event: AgentAssistEvent): Promise<void> {
  try {
    const channel = `agent_assist:${orgId}:${agentId}`;
    await getRedisClient().publish(channel, JSON.stringify(event));
    logger.debug("AgentAssist", `Published to ${channel}: ${event.suggestions.length} suggestions`);
  } catch (err) {
    logger.warn("AgentAssist", `Redis publish failed: ${err}`);
  }
}

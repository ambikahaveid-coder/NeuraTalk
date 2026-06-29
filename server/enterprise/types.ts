/**
 * Enterprise AI Overlay — Type Definitions
 *
 * The enterprise mode makes NeuraTalk an invisible AI layer
 * between a carrier SIP trunk and the business's existing PBX/phone system.
 * The enterprise never needs to migrate numbers.
 *
 * Topology:
 *   PSTN Carrier ──► NeuraTalk SBC (Kamailio) ──► AI Engine ──► Business PBX
 *
 * NeuraTalk adds:
 *   - Real-time transcription on every call
 *   - Live translation (agent speaks English, customer hears Hindi)
 *   - Sentiment alerts (angry customer → escalate)
 *   - Agent assist (AI suggests next response)
 *   - Auto call summary + CRM push after hangup
 */

export type ConnectorType = "sip_trunk" | "sip_registration" | "webrtc" | "pstn_forward";

export type VerificationStatus = "pending" | "verified" | "failed" | "expired";

export interface EnterpriseNumberConfig {
  id: string;
  organizationId: string;
  phoneNumber: string;
  displayName: string;
  connectorType: ConnectorType;
  verificationStatus: VerificationStatus;

  sipConfig?: {
    host: string;
    port: number;
    transport: "UDP" | "TCP" | "TLS";
    username?: string;
    realm?: string;
  };

  pstnForwardConfig?: {
    forwardTo: string;
    welcomeMessageEnabled: boolean;
    welcomeMessageText?: string;
  };

  aiConfig: {
    transcriptionEnabled: boolean;
    translationEnabled: boolean;
    sourceLanguage: string;
    targetLanguage?: string;
    sentimentEnabled: boolean;
    agentAssistEnabled: boolean;
    autoSummaryEnabled: boolean;
    recordingEnabled: boolean;
  };

  createdAt: string;
  updatedAt: string;
}

export interface AgentAssistEvent {
  callId: string;
  organizationId: string;
  agentId: string;
  trigger: "customer_utterance" | "silence" | "keyword" | "sentiment_drop";
  customerTranscript: string;
  suggestions: AgentSuggestion[];
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  escalationRecommended: boolean;
  timestampMs: number;
}

export interface AgentSuggestion {
  id: string;
  text: string;
  confidence: number;
  category: "response" | "info" | "escalation" | "offer" | "close";
  source: "knowledge_base" | "llm" | "script";
}

export interface EnterpriseCallSession {
  callId: string;
  organizationId: string;
  numberId: string;
  agentId?: string;
  customerId?: string;
  customerNumber: string;
  direction: "inbound" | "outbound";
  startedAt: string;
  aiFeatures: string[];
  rtpForkActive: boolean;
  transcript: Array<{ speaker: "agent" | "customer"; text: string; translatedText?: string; timestampMs: number }>;
}

export interface CRMPushPayload {
  callId: string;
  organizationId: string;
  customerNumber: string;
  agentId?: string;
  durationSeconds: number;
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  sentiment: string;
  recordingUrl?: string;
  transcriptUrl?: string;
  timestamp: string;
}

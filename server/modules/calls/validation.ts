import { randomUUID } from "node:crypto";
import {
  assertSmartCallTransition,
  SMART_CALL_STATE,
  type SmartCallState,
} from "./lifecycle";
import { BillingEngine } from "../../billing-engine";

const TELECOM_E2E_CHECKLIST = [
  "app -> India mobile PSTN call via MSG91 SIP bridge",
  "app -> international PSTN call with answer and teardown",
  "10+ minute translated PSTN call with per-second billing verification",
  "low balance hard-stop during ACTIVE call",
  "provider timeout fallback without webhook delivery",
  "Android 4G app -> PSTN audio stability and latency audit",
  "iOS app -> PSTN answer flow and background recovery",
  "dual-instance billing consistency during concurrent active calls",
];

export async function runTelecomValidationSimulation() {
  const sessionId = `validate_${randomUUID()}`;
  const transitions: SmartCallState[] = [
    SMART_CALL_STATE.CREATED,
    SMART_CALL_STATE.RINGING,
    SMART_CALL_STATE.ANSWERED,
    SMART_CALL_STATE.ACTIVE,
    SMART_CALL_STATE.ENDED,
  ];

  for (let index = 1; index < transitions.length; index += 1) {
    assertSmartCallTransition(transitions[index - 1], transitions[index]);
  }

  const authorization = await BillingEngine.startCallSession({
    sessionId,
    userId: null,
    organizationId: null,
    callType: "voice",
    translationEnabled: true,
    recordingEnabled: false,
    joinMethod: "app_to_pstn",
    activateOnAnswer: true,
  });

  if (!authorization.allowed) {
    return {
      ok: false,
      sessionId,
      reason: authorization.reason || "AUTHORIZATION_FAILED",
      lifecycleTransitions: transitions,
      telecomE2EChecklist: TELECOM_E2E_CHECKLIST,
    };
  }

  const activation = await BillingEngine.activateCallSession(sessionId);
  await BillingEngine.tickCallSession(sessionId, 5);
  const progress = await BillingEngine.getCallSessionProgress(sessionId);
  const finalization = await BillingEngine.finalizeCallSession(sessionId, "completed");

  return {
    ok: true,
    sessionId,
    lifecycleTransitions: transitions,
    billing: {
      authorization,
      activation,
      progress,
      finalization,
    },
    telecomE2EChecklist: TELECOM_E2E_CHECKLIST,
  };
}

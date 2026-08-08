/**
 * Bridges the existing internal call-lifecycle event bus
 * (smartCallEvents in server/modules/calls/smart-router.ts) to outbound
 * customer webhooks — deliberately NOT modifying smart-router.ts's call
 * logic itself. This keeps the webhook feature purely additive: if this
 * module were deleted, calling behavior is completely unaffected.
 *
 * Reasons/heuristics used to classify "call_ended" as call.ended vs.
 * call.failed are documented inline — they're a best-effort classification
 * over the free-text `reason` strings used across the call/PSTN code, not
 * an exhaustive enum match, since no single canonical reason enum exists
 * in the codebase today.
 */
import { smartCallEvents, getSmartCall } from "../calls/smart-router";
import { dispatchEvent } from "./service";
import { logger } from "../../observability";

const FAILURE_REASON_PATTERN = /fail|error|busy|no_?answer|declined|rejected|missed|unreachable/i;

let wired = false;

export function wireCallLifecycleWebhooks(): void {
  if (wired) return; // idempotent — safe if startup calls this more than once
  wired = true;

  smartCallEvents.on("call_created", (payload: any) => {
    dispatchForPayload(payload, "call.initiated");
  });

  smartCallEvents.on("call_active", (payload: any) => {
    dispatchForPayload(payload, "call.connected");
  });

  smartCallEvents.on("call_ended", (payload: any) => {
    dispatchForPayload(payload, "call.ended");
    const reason = typeof payload?.reason === "string" ? payload.reason : "";
    if (FAILURE_REASON_PATTERN.test(reason)) {
      dispatchForPayload(payload, "call.failed");
    }
  });

  smartCallEvents.on("translation_started", (payload: { callId: string }) => {
    void (async () => {
      try {
        const record = await getSmartCall(payload.callId);
        if (!record) return;
        const orgId = record.callerOrganizationId ?? record.calleeOrganizationId ?? null;
        if (!orgId) return;
        await dispatchEvent(orgId, "translation.started", { callId: payload.callId });
      } catch (error) {
        logger.warn("WebhookEventBridge", `translation_started dispatch failed: ${String(error)}`);
      }
    })();
  });

  logger.info("WebhookEventBridge", "Call-lifecycle → outbound-webhook event bridge wired");
}

function dispatchForPayload(payload: any, eventType: Parameters<typeof dispatchEvent>[1]): void {
  const orgId = payload?.callerOrganizationId ?? payload?.calleeOrganizationId ?? null;
  if (!orgId) return; // no org context (e.g. a personal B2C call) — nothing to notify
  void dispatchEvent(orgId, eventType, payload).catch((error) => {
    logger.warn("WebhookEventBridge", `dispatch failed for ${eventType}: ${String(error)}`);
  });
}

/**
 * Real call recording — LiveKit Egress (server-side room-composite audio
 * capture) uploaded directly to S3-compatible object storage.
 *
 * A prior audit found call recording to be entirely unimplemented: an
 * `enableRecording` flag was threaded through billing/consent code, but no
 * LiveKit Egress call existed anywhere and no audio was ever actually
 * captured or stored. This module is the real implementation.
 *
 * Storage choice, justified: the codebase's existing ObjectStorageService
 * (server/ai_integrations/object_storage/) uses a Replit-specific sidecar
 * (`http://127.0.0.1:1106`) to mint short-lived GCS credentials — that
 * sidecar only exists inside the Replit dev environment and there is no
 * equivalent credential path configured for the actual DigitalOcean
 * production deployment (confirmed: no GCS/service-account vars in
 * .env.example). Reusing it here would silently not work in production.
 * Instead, recordings upload directly via LiveKit Egress's native S3
 * output to any S3-compatible bucket (AWS S3, or DigitalOcean Spaces,
 * which is S3-compatible and is the natural choice given this app already
 * deploys to DigitalOcean) — configured via new RECORDING_S3_* env vars,
 * soft-optional like the rest of this codebase's external integrations.
 */
import {
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
  EgressStatus,
  type EgressInfo,
} from "livekit-server-sdk";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { callRecordings, RECORDING_STATUS, type CallRecording } from "@shared/schema";
import { getConsent } from "./call-privacy";
import { getSmartCall } from "./modules/calls/smart-router";
import { logger } from "./observability";

function requiredEnv(name: string): string | null {
  return process.env[name]?.trim() || null;
}

export function isRecordingStorageConfigured(): boolean {
  return Boolean(
    requiredEnv("RECORDING_S3_BUCKET") &&
    requiredEnv("RECORDING_S3_ACCESS_KEY") &&
    requiredEnv("RECORDING_S3_SECRET") &&
    requiredEnv("RECORDING_S3_REGION"),
  );
}

function getS3Client(): S3Client {
  return new S3Client({
    region: requiredEnv("RECORDING_S3_REGION") || "us-east-1",
    endpoint: requiredEnv("RECORDING_S3_ENDPOINT") || undefined, // e.g. https://<region>.digitaloceanspaces.com
    forcePathStyle: process.env.RECORDING_S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: requiredEnv("RECORDING_S3_ACCESS_KEY")!,
      secretAccessKey: requiredEnv("RECORDING_S3_SECRET")!,
    },
  });
}

function getEgressClient(): EgressClient {
  const host = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  if (!host || !apiKey || !apiSecret) {
    throw new Error("LIVEKIT_NOT_CONFIGURED_FOR_EGRESS");
  }
  return new EgressClient(host, apiKey, apiSecret);
}

export type StartRecordingResult =
  | { success: true; recordingId: number; egressId: string }
  | { success: false; reason: "STORAGE_NOT_CONFIGURED" | "LIVEKIT_NOT_CONFIGURED" | "CONSENT_REQUIRED" | "CALL_NOT_FOUND" | "EGRESS_START_FAILED" };

/**
 * Requires BOTH participants (where they're an authenticated app user with
 * a consent record — a PSTN leg has no NeuraTalk account to consent with,
 * consistent with how the rest of this codebase's consent gate already
 * only checks app-side users) to have granted `audioRecording` consent
 * (shared/schema.ts's callConsents.audioRecording) before starting Egress.
 */
export async function startRecording(input: {
  callId: string;
  requestedByUserId: number;
  organizationId: number | null;
}): Promise<StartRecordingResult> {
  if (!isRecordingStorageConfigured()) {
    return { success: false, reason: "STORAGE_NOT_CONFIGURED" };
  }

  const call = await getSmartCall(input.callId);
  if (!call) return { success: false, reason: "CALL_NOT_FOUND" };

  const participantUserIds = [input.requestedByUserId];
  const calleeUserIdNum = call.calleeUserId ? Number(call.calleeUserId) : null;
  if (calleeUserIdNum && Number.isFinite(calleeUserIdNum) && calleeUserIdNum !== input.requestedByUserId) {
    participantUserIds.push(calleeUserIdNum);
  }

  for (const userId of participantUserIds) {
    // NOTE: deliberately NOT using call-privacy.ts's hasValidConsent() here —
    // that function only checks translationProcessing consent (required for
    // any call at all) and does not look at audioRecording specifically. A
    // user who has only consented to translation (the default/required
    // flow) but never to being recorded would incorrectly pass that check.
    // audioRecording defaults to false in the schema, so this must be
    // checked explicitly and separately.
    const consent = await getConsent(userId).catch(() => null);
    if (!consent?.audioRecording) {
      return { success: false, reason: "CONSENT_REQUIRED" };
    }
  }

  let egressClient: EgressClient;
  try {
    egressClient = getEgressClient();
  } catch {
    return { success: false, reason: "LIVEKIT_NOT_CONFIGURED" };
  }

  const [recordingRow] = await db.insert(callRecordings).values({
    callId: input.callId,
    organizationId: input.organizationId,
    status: RECORDING_STATUS.STARTING,
    requestedBy: input.requestedByUserId,
  }).returning();

  try {
    const output = new EncodedFileOutput({
      fileType: EncodedFileType.OGG,
      filepath: `recordings/${input.callId}-{time}.ogg`,
      output: {
        case: "s3",
        value: new S3Upload({
          accessKey: requiredEnv("RECORDING_S3_ACCESS_KEY")!,
          secret: requiredEnv("RECORDING_S3_SECRET")!,
          region: requiredEnv("RECORDING_S3_REGION")!,
          endpoint: requiredEnv("RECORDING_S3_ENDPOINT") || "",
          bucket: requiredEnv("RECORDING_S3_BUCKET")!,
          forcePathStyle: process.env.RECORDING_S3_FORCE_PATH_STYLE === "true",
        }),
      },
    });

    // Audio-only — this is a voice/translation platform; video egress is a
    // deliberate, documented scope decision, not an oversight.
    const egressInfo = await egressClient.startRoomCompositeEgress(input.callId, { file: output }, { audioOnly: true });

    await db.update(callRecordings).set({
      egressId: egressInfo.egressId,
      status: RECORDING_STATUS.ACTIVE,
    }).where(eq(callRecordings.id, recordingRow.id));

    logger.info("Recording", `Started recording for call ${input.callId}, egressId=${egressInfo.egressId}`);
    return { success: true, recordingId: recordingRow.id, egressId: egressInfo.egressId };
  } catch (error) {
    await db.update(callRecordings).set({
      status: RECORDING_STATUS.FAILED,
      failureReason: String(error instanceof Error ? error.message : error).slice(0, 500),
    }).where(eq(callRecordings.id, recordingRow.id));
    logger.error("Recording", `Egress start failed for call ${input.callId}`, error as Error);
    return { success: false, reason: "EGRESS_START_FAILED" };
  }
}

export async function stopRecording(callId: string): Promise<boolean> {
  const [row] = await db.select().from(callRecordings).where(eq(callRecordings.callId, callId));
  if (!row || !row.egressId || row.status !== RECORDING_STATUS.ACTIVE) return false;

  try {
    const egressClient = getEgressClient();
    await egressClient.stopEgress(row.egressId);
    return true;
  } catch (error) {
    logger.warn("Recording", `stopEgress failed for ${callId}: ${String(error)}`);
    return false;
  }
}

/**
 * Called from the LiveKit webhook handler (server/modules/calls/controller.ts
 * livekitWebhook) on an `egress_ended` event — finalizes the recording row
 * with the actual storage path/duration LiveKit reports, and marks it
 * failed if Egress itself reported an error (e.g. the room had no audio
 * tracks, or the S3 upload failed).
 */
export async function handleEgressEndedWebhook(event: EgressInfo): Promise<CallRecording | null> {
  const [row] = await db.select().from(callRecordings).where(eq(callRecordings.egressId, event.egressId));
  if (!row) return null;

  const failed = event.status === EgressStatus.EGRESS_FAILED || event.status === EgressStatus.EGRESS_ABORTED;
  const file = event.fileResults?.[0];
  // LiveKit reports duration in nanoseconds (bigint).
  const durationSeconds = file ? Math.round(Number(file.duration) / 1_000_000_000) : null;

  const [updated] = await db.update(callRecordings).set({
    status: failed ? RECORDING_STATUS.FAILED : RECORDING_STATUS.COMPLETE,
    storagePath: file?.filename ?? null,
    durationSeconds,
    failureReason: failed ? (event.error || "Egress reported failure").slice(0, 500) : null,
    completedAt: new Date(),
  }).where(eq(callRecordings.id, row.id)).returning();

  logger.info("Recording", `Egress ${event.egressId} for call ${row.callId} finished: status=${EgressStatus[event.status]}, durationSeconds=${durationSeconds}`);
  return updated ?? null;
}

export async function getRecordingForCall(callId: string): Promise<CallRecording | null> {
  const [row] = await db.select().from(callRecordings).where(eq(callRecordings.callId, callId));
  return row ?? null;
}

/** Presigned, time-limited download URL — never expose the bucket publicly or return raw credentials to clients. */
export async function getRecordingDownloadUrl(recording: CallRecording, expiresInSeconds = 300): Promise<string | null> {
  if (!recording.storagePath || recording.status !== RECORDING_STATUS.COMPLETE) return null;
  if (!isRecordingStorageConfigured()) return null;

  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: requiredEnv("RECORDING_S3_BUCKET")!,
    Key: recording.storagePath,
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

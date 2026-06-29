/**
 * Media Gateway Provider
 *
 * Unified media control layer: FreeSWITCH (B2BUA) + RTPEngine (RTP proxy/fork).
 * Used by the smart-router to set up media paths for PSTN calls.
 *
 * Call flow:
 *   PSTN carrier → Kamailio (SIP signaling) → FreeSWITCH (B2BUA)
 *   RTP: PSTN carrier ↔ RTPEngine ↔ WebRTC client (LiveKit)
 *   AI: RTPEngine forks RTP copy → AI workers (STT/Translation)
 *
 * When FreeSWITCH/RTPEngine are not configured, falls back gracefully
 * to the existing LiveKit SIP domain bridging approach.
 */

import { logger } from "../observability";
import { getFreeSwitchClient } from "./freeswitch/esl-client";
import { getRTPEngineClient } from "./rtpengine/ng-client";

export interface MediaBridgeParams {
  callId: string;
  fromTag: string;
  toTag?: string;
  pstnSdp: string;
  webrtcSdp?: string;
  aiWorkerEndpoint?: string;
  record?: boolean;
  recordingPath?: string;
  fssUuid?: string;
}

export interface MediaBridgeResult {
  success: boolean;
  rewrittenSdp?: string;
  fssUuid?: string;
  recording?: boolean;
  error?: string;
}

export interface MediaGatewayHealth {
  freeSwitchConnected: boolean;
  rtpEngineHealthy: boolean;
  rtpEngineLatencyMs?: number;
  activeCalls: number;
}

export class MediaGateway {
  private get fss() { return getFreeSwitchClient(); }
  private get rtpe() { return getRTPEngineClient(); }

  isFullyConfigured(): boolean {
    return this.fss.isConfigured() && this.rtpe.isConfigured();
  }

  isFSSAvailable(): boolean {
    return this.fss.isConfigured() && this.fss.isConnected();
  }

  isRTPEAvailable(): boolean {
    return this.rtpe.isConfigured();
  }

  /**
   * Set up media path for an inbound PSTN call.
   * Rewrites SDP via RTPEngine for NAT traversal and optional AI forking.
   */
  async setupInboundMedia(params: MediaBridgeParams): Promise<MediaBridgeResult> {
    if (!this.isRTPEAvailable()) {
      logger.debug("MediaGateway", `RTPEngine not configured — skip SDP rewrite for ${params.callId}`);
      return { success: true };
    }

    try {
      const flags = ["trust address", "SIP source address"];
      const rewrittenSdp = await this.rtpe.offer({
        callId: params.callId,
        fromTag: params.fromTag,
        sdp: params.pstnSdp,
        flags,
        direction: ["public", "public"],
        iceMode: params.webrtcSdp ? "force" : "remove",
        rtcpMux: params.webrtcSdp ? "offer" : "demux",
      });

      if (!rewrittenSdp) {
        return { success: false, error: "RTPEngine offer failed" };
      }

      // Fork RTP to AI worker if configured
      if (params.aiWorkerEndpoint) {
        const forked = await this.rtpe.startFork(params.callId, params.fromTag, params.aiWorkerEndpoint);
        if (!forked) {
          logger.warn("MediaGateway", `AI fork failed for ${params.callId} — continuing without fork`);
        }
      }

      return { success: true, rewrittenSdp };
    } catch (err) {
      logger.warn("MediaGateway", `setupInboundMedia error: ${err}`);
      return { success: false, error: String(err) };
    }
  }

  /**
   * Complete media setup with answer SDP (after WebRTC client answers).
   */
  async completeMediaSetup(params: MediaBridgeParams & { toTag: string }): Promise<MediaBridgeResult> {
    if (!this.isRTPEAvailable() || !params.webrtcSdp) {
      return { success: true };
    }

    try {
      const rewrittenSdp = await this.rtpe.answer({
        callId: params.callId,
        fromTag: params.fromTag,
        toTag: params.toTag,
        sdp: params.webrtcSdp,
        flags: ["trust address"],
        iceMode: "force",
        rtcpMux: "require",
      });

      if (!rewrittenSdp) {
        return { success: false, error: "RTPEngine answer failed" };
      }

      // Start FreeSWITCH-level recording if requested
      let recording = false;
      if (params.record && params.recordingPath && this.isFSSAvailable() && params.fssUuid) {
        recording = await this.fss.startRecord(params.fssUuid, params.recordingPath);
      }

      return { success: true, rewrittenSdp, recording };
    } catch (err) {
      logger.warn("MediaGateway", `completeMediaSetup error: ${err}`);
      return { success: false, error: String(err) };
    }
  }

  /**
   * Tear down media session on call end.
   */
  async teardown(callId: string, fromTag: string, toTag?: string, fssUuid?: string): Promise<void> {
    const tasks: Promise<unknown>[] = [];

    if (this.isRTPEAvailable()) {
      tasks.push(this.rtpe.delete(callId, fromTag, toTag).catch((err) => {
        logger.warn("MediaGateway", `RTPEngine delete error: ${err}`);
      }));
    }

    if (fssUuid && this.isFSSAvailable()) {
      tasks.push(this.fss.hangup(fssUuid).catch((err) => {
        logger.warn("MediaGateway", `FreeSWITCH hangup error: ${err}`);
      }));
    }

    await Promise.allSettled(tasks);
    logger.debug("MediaGateway", `Media teardown complete: ${callId}`);
  }

  /**
   * Transfer a call via FreeSWITCH.
   */
  async transferCall(fssUuid: string, destination: string): Promise<boolean> {
    if (!this.isFSSAvailable()) {
      logger.warn("MediaGateway", "FreeSWITCH not available for transfer");
      return false;
    }
    return this.fss.transfer(fssUuid, destination);
  }

  /**
   * Send DTMF via FreeSWITCH.
   */
  async sendDtmf(fssUuid: string, digits: string): Promise<boolean> {
    if (!this.isFSSAvailable()) return false;
    return this.fss.sendDtmf(fssUuid, digits);
  }

  /**
   * Play announcement on a call (IVR, queue music, etc.).
   */
  async playAnnouncement(fssUuid: string, fileOrTTS: string): Promise<boolean> {
    if (!this.isFSSAvailable()) return false;
    return this.fss.playback(fssUuid, fileOrTTS);
  }

  /**
   * Get combined health status of media subsystems.
   */
  async getHealth(): Promise<MediaGatewayHealth> {
    const [rtpePing, channels] = await Promise.allSettled([
      this.rtpe.ping(),
      this.fss.isConnected() ? this.fss.listChannels() : Promise.resolve([]),
    ]);

    const rtpResult = rtpePing.status === "fulfilled" ? rtpePing.value : { healthy: false, latencyMs: 0 };
    const chResult = channels.status === "fulfilled" ? channels.value : [];

    return {
      freeSwitchConnected: this.fss.isConnected(),
      rtpEngineHealthy: rtpResult.healthy,
      rtpEngineLatencyMs: rtpResult.latencyMs,
      activeCalls: chResult.length,
    };
  }
}

let _gateway: MediaGateway | null = null;

export function getMediaGateway(): MediaGateway {
  if (!_gateway) {
    _gateway = new MediaGateway();
  }
  return _gateway;
}

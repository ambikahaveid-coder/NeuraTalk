/**
 * RTPEngine ng Protocol Client
 *
 * Controls RTPEngine via its ng control protocol over UDP.
 * Used for:
 *   - SDP offer/answer rewriting (NAT traversal)
 *   - RTP forking — send copy of media to AI workers
 *   - SRTP ↔ RTP transcoding
 *   - Codec transcoding (G.711 ↔ Opus for WebRTC)
 *   - Active call statistics
 *
 * RTPEngine must be running with:
 *   --listen-ng=127.0.0.1:22222
 *
 * env:
 *   RTPENGINE_HOST — RTPEngine host (default: localhost)
 *   RTPENGINE_PORT — ng protocol UDP port (default: 22222)
 *
 * Protocol: bencode-encoded dict over UDP.
 * Ref: https://github.com/sipwise/rtpengine/blob/master/docs/ng-control-protocol.md
 */

import * as dgram from "node:dgram";
import { createHash } from "node:crypto";
import { logger } from "../../observability";

const RTPE_HOST = () => process.env.RTPENGINE_HOST?.trim() || "localhost";
const RTPE_PORT = () => parseInt(process.env.RTPENGINE_PORT || "22222", 10);
const RTPE_TIMEOUT_MS = 5_000;

// Minimal bencode encoder (only dict, list, string, int needed for ng protocol)
function bencode(val: unknown): string {
  if (typeof val === "number" || typeof val === "bigint") {
    return `i${val}e`;
  }
  if (typeof val === "string") {
    return `${val.length}:${val}`;
  }
  if (Array.isArray(val)) {
    return `l${val.map(bencode).join("")}e`;
  }
  if (val !== null && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const inner = Object.keys(obj)
      .sort()
      .map((k) => `${bencode(k)}${bencode(obj[k])}`)
      .join("");
    return `d${inner}e`;
  }
  return `0:`;
}

// Minimal bencode decoder — returns [value, remaining_string]
function bdecode(s: string): [unknown, string] {
  if (s[0] === "d") {
    const obj: Record<string, unknown> = {};
    let rest = s.slice(1);
    while (rest[0] !== "e") {
      const [key, r1] = bdecode(rest);
      const [val, r2] = bdecode(r1);
      obj[key as string] = val;
      rest = r2;
    }
    return [obj, rest.slice(1)];
  }
  if (s[0] === "l") {
    const arr: unknown[] = [];
    let rest = s.slice(1);
    while (rest[0] !== "e") {
      const [val, r] = bdecode(rest);
      arr.push(val);
      rest = r;
    }
    return [arr, rest.slice(1)];
  }
  if (s[0] === "i") {
    const end = s.indexOf("e");
    return [parseInt(s.slice(1, end), 10), s.slice(end + 1)];
  }
  // String: length:content
  const colon = s.indexOf(":");
  const len = parseInt(s.slice(0, colon), 10);
  const start = colon + 1;
  return [s.slice(start, start + len), s.slice(start + len)];
}

export interface RTPEngineOfferParams {
  callId: string;
  fromTag: string;
  sdp: string;
  flags?: string[];
  codecMask?: string[];
  direction?: [string, string];
  iceMode?: "remove" | "force" | "optional";
  rtcpMux?: "offer" | "require" | "demux" | "accept" | "reject";
  forkTo?: string[];
}

export interface RTPEngineAnswerParams extends RTPEngineOfferParams {
  toTag: string;
}

export interface RTPEngineStats {
  callId: string;
  packetsReceived: number;
  packetsSent: number;
  bytesReceived: number;
  bytesSent: number;
  packetsLost: number;
  jitter: number;
  rtt: number;
}

export class RTPEngineClient {
  private socket: dgram.Socket | null = null;

  isConfigured(): boolean {
    return Boolean(process.env.RTPENGINE_HOST);
  }

  private newCallId(): string {
    return createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 16);
  }

  private async send(command: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const cookie = this.newCallId();
      const msg = `${cookie} ${bencode({ command, ...params })}`;
      const buf = Buffer.from(msg, "utf8");

      const sock = dgram.createSocket("udp4");
      const timer = setTimeout(() => {
        sock.close();
        reject(new Error(`RTPEngine ng timeout after ${RTPE_TIMEOUT_MS}ms for command=${command}`));
      }, RTPE_TIMEOUT_MS);

      sock.on("message", (raw) => {
        clearTimeout(timer);
        sock.close();
        try {
          const str = raw.toString("utf8");
          const spaceIdx = str.indexOf(" ");
          const respCookie = str.slice(0, spaceIdx);
          const payload = str.slice(spaceIdx + 1);
          if (respCookie !== cookie) {
            reject(new Error("Cookie mismatch in RTPEngine response"));
            return;
          }
          const [decoded] = bdecode(payload);
          resolve(decoded as Record<string, unknown>);
        } catch (err) {
          reject(new Error(`Failed to decode RTPEngine response: ${err}`));
        }
      });

      sock.on("error", (err) => {
        clearTimeout(timer);
        sock.close();
        reject(err);
      });

      sock.send(buf, 0, buf.length, RTPE_PORT(), RTPE_HOST(), (err) => {
        if (err) {
          clearTimeout(timer);
          sock.close();
          reject(err);
        }
      });
    });
  }

  /**
   * Process SDP offer — RTPEngine rewrites the SDP to its own address.
   * Returns the rewritten SDP for the offer side.
   */
  async offer(params: RTPEngineOfferParams): Promise<string | null> {
    if (!this.isConfigured()) return null;
    try {
      const req: Record<string, unknown> = {
        "call-id": params.callId,
        "from-tag": params.fromTag,
        sdp: params.sdp,
      };
      if (params.flags?.length) req.flags = params.flags;
      if (params.direction) req.direction = params.direction;
      if (params.iceMode) req.ICE = params.iceMode;
      if (params.rtcpMux) req["rtcp-mux"] = [params.rtcpMux];
      if (params.forkTo?.length) req["media address"] = params.forkTo;

      const resp = await this.send("offer", req);
      if (resp.result !== "ok") {
        logger.warn("RTPEngine", `offer failed: ${JSON.stringify(resp)}`);
        return null;
      }
      logger.debug("RTPEngine", `offer OK callId=${params.callId}`);
      return resp.sdp as string;
    } catch (err) {
      logger.warn("RTPEngine", `offer error: ${err}`);
      return null;
    }
  }

  /**
   * Process SDP answer — completes the media path setup.
   * Returns rewritten SDP for the answer side.
   */
  async answer(params: RTPEngineAnswerParams): Promise<string | null> {
    if (!this.isConfigured()) return null;
    try {
      const req: Record<string, unknown> = {
        "call-id": params.callId,
        "from-tag": params.fromTag,
        "to-tag": params.toTag,
        sdp: params.sdp,
      };
      if (params.flags?.length) req.flags = params.flags;
      if (params.iceMode) req.ICE = params.iceMode;
      if (params.rtcpMux) req["rtcp-mux"] = [params.rtcpMux];

      const resp = await this.send("answer", req);
      if (resp.result !== "ok") {
        logger.warn("RTPEngine", `answer failed: ${JSON.stringify(resp)}`);
        return null;
      }
      logger.debug("RTPEngine", `answer OK callId=${params.callId}`);
      return resp.sdp as string;
    } catch (err) {
      logger.warn("RTPEngine", `answer error: ${err}`);
      return null;
    }
  }

  /**
   * Delete an RTP session (call teardown).
   */
  async delete(callId: string, fromTag: string, toTag?: string): Promise<boolean> {
    if (!this.isConfigured()) return true;
    try {
      const req: Record<string, unknown> = {
        "call-id": callId,
        "from-tag": fromTag,
      };
      if (toTag) req["to-tag"] = toTag;
      const resp = await this.send("delete", req);
      const ok = resp.result === "ok";
      if (!ok) logger.warn("RTPEngine", `delete failed: ${JSON.stringify(resp)}`);
      return ok;
    } catch (err) {
      logger.warn("RTPEngine", `delete error: ${err}`);
      return false;
    }
  }

  /**
   * Start media forking — send RTP copy to an AI worker endpoint.
   * The forkTarget should be "host:port" of the AI worker.
   */
  async startFork(callId: string, fromTag: string, forkTarget: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const resp = await this.send("start forwarding", {
        "call-id": callId,
        "from-tag": fromTag,
        "media address": forkTarget,
      });
      const ok = resp.result === "ok";
      if (ok) {
        logger.info("RTPEngine", `RTP fork started: callId=${callId} → ${forkTarget}`);
      }
      return ok;
    } catch (err) {
      logger.warn("RTPEngine", `startFork error: ${err}`);
      return false;
    }
  }

  /**
   * Stop media forking for a call.
   */
  async stopFork(callId: string, fromTag: string): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      const resp = await this.send("stop forwarding", {
        "call-id": callId,
        "from-tag": fromTag,
      });
      return resp.result === "ok";
    } catch (err) {
      logger.warn("RTPEngine", `stopFork error: ${err}`);
      return false;
    }
  }

  /**
   * Get real-time statistics for an active call.
   */
  async getStats(callId: string, fromTag: string, toTag?: string): Promise<RTPEngineStats | null> {
    if (!this.isConfigured()) return null;
    try {
      const req: Record<string, unknown> = {
        "call-id": callId,
        "from-tag": fromTag,
      };
      if (toTag) req["to-tag"] = toTag;
      const resp = await this.send("query", req);
      if (resp.result !== "ok") return null;

      const media = (resp["SSRC"] as any)?.[0] || {};
      return {
        callId,
        packetsReceived: media["packets received"] || 0,
        packetsSent: media["packets sent"] || 0,
        bytesReceived: media["bytes received"] || 0,
        bytesSent: media["bytes sent"] || 0,
        packetsLost: media["packets lost"] || 0,
        jitter: media.jitter || 0,
        rtt: media.rtt || 0,
      };
    } catch (err) {
      logger.warn("RTPEngine", `getStats error: ${err}`);
      return null;
    }
  }

  /**
   * List all active calls in RTPEngine.
   */
  async listCalls(): Promise<string[]> {
    if (!this.isConfigured()) return [];
    try {
      const resp = await this.send("list", {});
      return (resp.calls as string[]) || [];
    } catch {
      return [];
    }
  }

  /**
   * Ping RTPEngine to check if it's up.
   */
  async ping(): Promise<{ healthy: boolean; latencyMs: number }> {
    if (!this.isConfigured()) return { healthy: false, latencyMs: 0 };
    const start = Date.now();
    try {
      const resp = await this.send("ping", {});
      const latencyMs = Date.now() - start;
      const healthy = resp.result === "pong";
      return { healthy, latencyMs };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }
}

let _rtpeClient: RTPEngineClient | null = null;

export function getRTPEngineClient(): RTPEngineClient {
  if (!_rtpeClient) {
    _rtpeClient = new RTPEngineClient();
  }
  return _rtpeClient;
}

/**
 * Generic SIP Trunk Provider
 *
 * Works with any RFC-3261 compliant SIP carrier:
 * Jio Business SIP, Airtel SIP, Tata Communications, BSNL, etc.
 *
 * Kamailio handles the actual SIP signaling.
 * This class represents trunk configuration and health management only.
 */

import { createHmac } from "node:crypto";
import { logger } from "../observability";
import type { SIPProvider, SIPTrunkConfig, SIPProviderHealth, TrunkStats } from "./provider";

const OPTIONS_TIMEOUT_MS = 5_000;

export class GenericSIPTrunk implements SIPProvider {
  readonly id: string;
  readonly name: string;
  readonly config: SIPTrunkConfig;

  constructor(config: SIPTrunkConfig) {
    this.id = config.id;
    this.name = config.name;
    this.config = config;
  }

  getSIPUri(): string {
    const transport = this.config.transport === "TLS" ? "sips" : "sip";
    return `${transport}:${this.config.host}:${this.config.port}`;
  }

  normalizeOutbound(number: string): string {
    const digits = number.replace(/\D/g, "");
    // Most Indian carriers want 91xxxxxxxxxx without the leading +
    if (this.config.provider === "jio" || this.config.provider === "airtel" || this.config.provider === "tata") {
      if (digits.startsWith("91") && digits.length === 12) return digits;
      if (digits.length === 10) return `91${digits}`;
    }
    // Default: strip leading +
    return digits;
  }

  normalizeInbound(number: string): string {
    const digits = number.replace(/\D/g, "");
    // Convert trunk format back to E.164
    if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    if (digits.length === 10) return `+91${digits}`;
    return `+${digits}`;
  }

  getOutboundHeaders(params: { from: string; to: string; callId: string }): Record<string, string> {
    const headers: Record<string, string> = {};

    if (this.config.callerIdMode === "asserted" || this.config.callerIdMode === "passthrough") {
      const cli = this.config.forcedCallerId || params.from;
      if (cli) {
        headers["P-Asserted-Identity"] = `<sip:${cli.replace(/\D/g, "")}@${this.config.fromDomain}>`;
      }
    }

    if (this.config.dltPeId) {
      headers["X-TRAI-PE-ID"] = this.config.dltPeId;
    }

    return headers;
  }

  async optionsPing(): Promise<SIPProviderHealth> {
    const start = Date.now();
    try {
      // Send a SIP OPTIONS request via UDP socket to measure trunk reachability
      // Real implementation delegates to Kamailio MI or a lightweight SIP OPTIONS sender
      const result = await sendSIPOptions(this.config.host, this.config.port, this.config.transport, OPTIONS_TIMEOUT_MS);
      const latencyMs = Date.now() - start;
      logger.info("SIPTrunk", `${this.name} OPTIONS: ${result.statusCode} in ${latencyMs}ms`);
      return {
        healthy: result.statusCode >= 200 && result.statusCode < 300,
        latencyMs,
        message: `SIP ${result.statusCode} ${result.reason}`,
        lastCheckedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: String(err),
        lastCheckedAt: new Date().toISOString(),
      };
    }
  }

  async getStats(): Promise<TrunkStats> {
    // In production, these come from Kamailio dispatcher stats via MI/XMLRPC
    // Placeholder returns safe defaults
    return {
      trunkId: this.id,
      activeCalls: 0,
      callsInLast24h: 0,
      successRate: 100,
      avgSetupLatencyMs: 0,
      lastOptionsPingMs: 0,
      lastOptionsPingAt: new Date().toISOString(),
      healthy: true,
    };
  }
}

/**
 * Lightweight SIP OPTIONS probe over UDP.
 * Does not require a full SIP stack — just checks if the host responds.
 */
async function sendSIPOptions(
  host: string,
  port: number,
  transport: string,
  timeoutMs: number,
): Promise<{ statusCode: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const dgram = require("dgram") as typeof import("dgram");
    const socket = dgram.createSocket("udp4");
    const callId = createHmac("sha256", `${Date.now()}`).update(host).digest("hex").slice(0, 8);
    const branch = `z9hG4bK${createHmac("sha256", callId).update("branch").digest("hex").slice(0, 8)}`;

    const optionsMsg = [
      `OPTIONS sip:${host}:${port} SIP/2.0`,
      `Via: SIP/2.0/UDP neuratalk-probe:5060;branch=${branch}`,
      `Max-Forwards: 1`,
      `From: <sip:probe@neuratalk.in>;tag=${callId}`,
      `To: <sip:probe@${host}>`,
      `Call-ID: ${callId}@neuratalk.in`,
      `CSeq: 1 OPTIONS`,
      `Content-Length: 0`,
      ``,
      ``,
    ].join("\r\n");

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`SIP OPTIONS timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on("message", (msg) => {
      clearTimeout(timer);
      socket.close();
      const response = msg.toString("utf8");
      const firstLine = response.split("\r\n")[0] || "";
      const match = firstLine.match(/SIP\/2\.0\s+(\d+)\s+(.*)/);
      if (match) {
        resolve({ statusCode: parseInt(match[1], 10), reason: match[2] || "" });
      } else {
        resolve({ statusCode: 200, reason: "OK" });
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      try { socket.close(); } catch { /* ignore */ }
      reject(err);
    });

    const buf = Buffer.from(optionsMsg, "utf8");
    socket.send(buf, 0, buf.length, port, host, (err) => {
      if (err) {
        clearTimeout(timer);
        socket.close();
        reject(err);
      }
    });
  });
}

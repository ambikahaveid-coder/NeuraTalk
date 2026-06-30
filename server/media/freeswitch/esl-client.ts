/**
 * FreeSWITCH Event Socket Layer (ESL) Client
 *
 * Controls FreeSWITCH B2BUA for media gateway operations:
 *   - Bridge PSTN legs to WebRTC/SIP clients
 *   - Record calls at interconnect point (TRAI compliance)
 *   - Playback announcements / IVR prompts
 *   - Send DTMF tones
 *   - Transfer calls between legs
 *   - Monitor active channels
 *
 * FreeSWITCH must be started with mod_event_socket loaded.
 * ESL connection is outbound: FreeSWITCH connects to us via:
 *   event_socket_outbound <host> <port>
 * Or we connect inbound via:
 *   event_socket_inbound <host> <port> <password>
 *
 * env:
 *   FREESWITCH_ESL_HOST      — FreeSWITCH ESL host (default: localhost)
 *   FREESWITCH_ESL_PORT      — ESL port (default: 8021)
 *   FREESWITCH_ESL_PASSWORD  — ESL password (default: ClueCon)
 */

import { EventEmitter } from "node:events";
import * as net from "node:net";
import { logger } from "../../observability";

const ESL_HOST = () => process.env.FREESWITCH_ESL_HOST?.trim() || "localhost";
const ESL_PORT = () => parseInt(process.env.FREESWITCH_ESL_PORT || "8021", 10);
// No default password — if FREESWITCH_ESL_PASSWORD is unset the connection attempt
// will fail (ESL auth rejected), which is the correct fail-closed behaviour.
const ESL_PASSWORD = () => process.env.FREESWITCH_ESL_PASSWORD?.trim() ?? "";

export interface ESLEvent {
  headers: Record<string, string>;
  body: string;
}

export interface ChannelInfo {
  uuid: string;
  direction: "inbound" | "outbound";
  state: string;
  callId: string;
  callerNumber: string;
  calleeNumber: string;
  durationSeconds: number;
}

export class FreeSwitchESLClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = "";
  private authenticated = false;
  private commandQueue: Array<{
    resolve: (val: string) => void;
    reject: (err: Error) => void;
  }> = [];
  private reconnectTimer: NodeJS.Timeout | null = null;
  private destroyed = false;

  constructor() {
    super();
  }

  isConfigured(): boolean {
    return Boolean(process.env.FREESWITCH_ESL_HOST);
  }

  isConnected(): boolean {
    return this.authenticated;
  }

  async connect(): Promise<void> {
    if (!this.isConfigured()) {
      logger.debug("FreeSwitchESL", "FREESWITCH_ESL_HOST not set — ESL disabled");
      return;
    }
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: ESL_HOST(), port: ESL_PORT() }, () => {
        logger.info("FreeSwitchESL", `Connected to ${ESL_HOST()}:${ESL_PORT()}`);
      });

      sock.setKeepAlive(true, 15_000);
      sock.setNoDelay(true);
      this.socket = sock;

      sock.on("data", (chunk) => this.onData(chunk));
      sock.on("error", (err) => {
        logger.warn("FreeSwitchESL", `Socket error: ${err.message}`);
        this.authenticated = false;
        this.emit("error", err);
        reject(err);
        this.scheduleReconnect();
      });
      sock.on("close", () => {
        logger.warn("FreeSwitchESL", "ESL connection closed");
        this.authenticated = false;
        this.emit("disconnect");
        this.scheduleReconnect();
      });

      // Wait for auth/request from FreeSWITCH
      this.once("auth_request", async () => {
        try {
          await this.sendCommand(`auth ${ESL_PASSWORD()}`);
          this.authenticated = true;
          await this.sendCommand("event plain CHANNEL_CREATE CHANNEL_ANSWER CHANNEL_HANGUP CHANNEL_BRIDGE RECORD_START RECORD_STOP");
          logger.info("FreeSwitchESL", "Authenticated and subscribed to events");
          resolve();
        } catch (err) {
          reject(err as Error);
        }
      });
    });
  }

  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.destroy();
    this.socket = null;
    this.authenticated = false;
  }

  private scheduleReconnect(): void {
    if (this.destroyed || !this.isConfigured()) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      logger.info("FreeSwitchESL", "Reconnecting to FreeSWITCH ESL...");
      this.connect().catch((err) => {
        logger.warn("FreeSwitchESL", `Reconnect failed: ${err}`);
      });
    }, 5_000);
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    while (true) {
      const headerEnd = this.buffer.indexOf("\n\n");
      if (headerEnd === -1) break;

      const headerBlock = this.buffer.slice(0, headerEnd);
      const headers = this.parseHeaders(headerBlock);
      const contentLength = parseInt(headers["Content-Length"] || "0", 10);
      const bodyStart = headerEnd + 2;

      if (this.buffer.length < bodyStart + contentLength) break;

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.slice(bodyStart + contentLength);

      const event: ESLEvent = { headers, body };
      this.handleEvent(event);
    }
  }

  private parseHeaders(block: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of block.split("\n")) {
      const idx = line.indexOf(": ");
      if (idx !== -1) {
        out[line.slice(0, idx).trim()] = decodeURIComponent(line.slice(idx + 2).trim());
      }
    }
    return out;
  }

  private handleEvent(event: ESLEvent): void {
    const ct = event.headers["Content-Type"] || "";

    if (ct === "auth/request") {
      this.emit("auth_request");
      return;
    }

    if (ct === "command/reply") {
      const waiter = this.commandQueue.shift();
      if (waiter) {
        const reply = event.headers["Reply-Text"] || "";
        if (reply.startsWith("+OK")) {
          waiter.resolve(reply);
        } else {
          waiter.reject(new Error(reply || "ESL command failed"));
        }
      }
      return;
    }

    if (ct === "text/event-plain") {
      const eventName = event.headers["Event-Name"] || "";
      this.emit("fsevent", event);
      this.emit(eventName.toLowerCase(), event);
    }

    if (ct === "api/response") {
      const waiter = this.commandQueue.shift();
      waiter?.resolve(event.body);
    }
  }

  private sendCommand(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("ESL not connected"));
        return;
      }
      this.commandQueue.push({ resolve, reject });
      this.socket.write(`${cmd}\n\n`);
    });
  }

  private async api(cmd: string): Promise<string> {
    if (!this.authenticated) throw new Error("ESL not authenticated");
    return this.sendCommand(`api ${cmd}`);
  }

  /** Bridge two legs: originate call to destination and bridge to an existing channel */
  async bridge(uuid: string, destination: string): Promise<boolean> {
    try {
      const result = await this.api(`uuid_bridge ${uuid} ${destination}`);
      logger.info("FreeSwitchESL", `Bridge ${uuid} → ${destination}: ${result.trim()}`);
      return result.trim().startsWith("+OK");
    } catch (err) {
      logger.warn("FreeSwitchESL", `Bridge failed: ${err}`);
      return false;
    }
  }

  /** Transfer a call leg to a new destination (attended or blind) */
  async transfer(uuid: string, extension: string, dialplan = "XML", context = "default"): Promise<boolean> {
    try {
      const result = await this.api(`uuid_transfer ${uuid} ${extension} ${dialplan} ${context}`);
      return result.trim().startsWith("+OK");
    } catch (err) {
      logger.warn("FreeSwitchESL", `Transfer failed: ${err}`);
      return false;
    }
  }

  /** Hangup a specific channel */
  async hangup(uuid: string, cause = "NORMAL_CLEARING"): Promise<boolean> {
    try {
      const result = await this.api(`uuid_kill ${uuid} ${cause}`);
      return result.trim().startsWith("+OK");
    } catch (err) {
      logger.warn("FreeSwitchESL", `Hangup failed: ${err}`);
      return false;
    }
  }

  /** Start recording a call to a file path */
  async startRecord(uuid: string, filePath: string, limit?: number): Promise<boolean> {
    const limitArg = limit ? ` ${limit}` : "";
    try {
      const result = await this.api(`uuid_record ${uuid} start ${filePath}${limitArg}`);
      logger.info("FreeSwitchESL", `Recording started: ${uuid} → ${filePath}`);
      return result.trim().startsWith("+OK");
    } catch (err) {
      logger.warn("FreeSwitchESL", `Start record failed: ${err}`);
      return false;
    }
  }

  /** Stop recording */
  async stopRecord(uuid: string, filePath: string): Promise<boolean> {
    try {
      const result = await this.api(`uuid_record ${uuid} stop ${filePath}`);
      logger.info("FreeSwitchESL", `Recording stopped: ${uuid}`);
      return result.trim().startsWith("+OK");
    } catch (err) {
      logger.warn("FreeSwitchESL", `Stop record failed: ${err}`);
      return false;
    }
  }

  /** Send DTMF tones on a channel */
  async sendDtmf(uuid: string, digits: string, durationMs = 250): Promise<boolean> {
    try {
      const result = await this.api(`uuid_send_dtmf ${uuid} ${digits}@${durationMs}`);
      return result.trim().startsWith("+OK");
    } catch (err) {
      logger.warn("FreeSwitchESL", `Send DTMF failed: ${err}`);
      return false;
    }
  }

  /** Play a media file or TTS prompt on a channel */
  async playback(uuid: string, fileOrTTS: string): Promise<boolean> {
    try {
      const result = await this.api(`uuid_broadcast ${uuid} ${fileOrTTS} both`);
      return result.trim().startsWith("+OK");
    } catch (err) {
      logger.warn("FreeSwitchESL", `Playback failed: ${err}`);
      return false;
    }
  }

  /** Set a channel variable */
  async setVar(uuid: string, varName: string, value: string): Promise<boolean> {
    try {
      const result = await this.api(`uuid_setvar ${uuid} ${varName} ${value}`);
      return result.trim().startsWith("+OK");
    } catch (err) {
      logger.warn("FreeSwitchESL", `Set var failed: ${err}`);
      return false;
    }
  }

  /** Get all active channels */
  async listChannels(): Promise<ChannelInfo[]> {
    try {
      const result = await this.api("show channels as json");
      const parsed = JSON.parse(result || "{}");
      const rows: any[] = parsed.rows || [];
      return rows.map((r) => ({
        uuid: r.uuid || "",
        direction: r.direction === "outbound" ? "outbound" : "inbound",
        state: r.callstate || r.state || "",
        callId: r["Caller-Unique-ID"] || r.uuid || "",
        callerNumber: r["Caller-ANI"] || r["Caller-Caller-ID-Number"] || "",
        calleeNumber: r["Caller-Destination-Number"] || "",
        durationSeconds: parseInt(r.duration || "0", 10),
      }));
    } catch {
      return [];
    }
  }

  /** Get channel variable from a UUID */
  async getChannelVar(uuid: string, varName: string): Promise<string | null> {
    try {
      const result = await this.api(`uuid_getvar ${uuid} ${varName}`);
      return result.trim() === "_undef_" ? null : result.trim();
    } catch {
      return null;
    }
  }

  /** Originate a new call (B-leg) and bridge to A-leg */
  async originate(
    destination: string,
    profile: string,
    context: string,
    extension: string,
    vars: Record<string, string> = {},
  ): Promise<string | null> {
    const varStr = Object.entries(vars)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    const varBlock = varStr ? `{${varStr}}` : "";
    const cmd = `originate ${varBlock}sofia/${profile}/${destination} ${extension} XML ${context}`;
    try {
      const result = await this.api(cmd);
      const match = result.trim().match(/^\+OK (.+)$/);
      if (match) return match[1]; // Returns UUID of the new channel
      throw new Error(result.trim());
    } catch (err) {
      logger.warn("FreeSwitchESL", `Originate failed: ${err}`);
      return null;
    }
  }
}

let _eslClient: FreeSwitchESLClient | null = null;

export function getFreeSwitchClient(): FreeSwitchESLClient {
  if (!_eslClient) {
    _eslClient = new FreeSwitchESLClient();
  }
  return _eslClient;
}

export async function initFreeSwitchESL(): Promise<void> {
  const client = getFreeSwitchClient();
  if (!client.isConfigured()) {
    logger.info("FreeSwitchESL", "FREESWITCH_ESL_HOST not set — FreeSWITCH media gateway disabled");
    return;
  }
  try {
    await client.connect();
  } catch (err) {
    logger.warn("FreeSwitchESL", `Initial connect failed (will retry): ${err}`);
  }
}

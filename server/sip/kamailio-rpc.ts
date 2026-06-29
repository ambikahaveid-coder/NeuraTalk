/**
 * Kamailio Management Interface (MI) Client
 *
 * Controls Kamailio via its MI (Management Interface) over HTTP/XMLRPC.
 * Used to:
 *   - Dynamically update dispatcher groups (add/remove trunks)
 *   - Force trunk failover
 *   - Query active SIP dialogs
 *   - Push LCR routing updates without restart
 *   - Monitor Kamailio statistics
 *
 * Kamailio must be started with:
 *   loadmodule "mi_http.so"
 *   modparam("mi_http", "port", 8080)
 *
 * KAMAILIO_MI_URL=http://kamailio-internal:8080/mi
 */

import { logger } from "../observability";

const MI_URL = () => (process.env.KAMAILIO_MI_URL || "").trim();
const MI_TIMEOUT_MS = 5_000;

export interface KamailioDialog {
  callId: string;
  fromTag: string;
  toTag: string;
  callee: string;
  state: "early" | "confirmed" | "terminated";
  duration: number;
  flags: string;
}

export interface DispatcherEntry {
  id: number;
  uri: string;
  flags: number;
  priority: number;
  attrs: string;
  state: "active" | "inactive" | "probing";
}

export class KamailioRPCClient {
  private miUrl: string;

  constructor(miUrl?: string) {
    this.miUrl = miUrl || MI_URL();
  }

  isConfigured(): boolean {
    return Boolean(this.miUrl);
  }

  /**
   * Execute a Kamailio MI command via HTTP GET/POST.
   * Returns parsed JSON response or null on failure.
   */
  private async mi(command: string, params: Record<string, string> = {}): Promise<any> {
    if (!this.miUrl) {
      logger.debug("KamailioRPC", `MI not configured — skipping command: ${command}`);
      return null;
    }

    const url = new URL(`${this.miUrl}/${command}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), MI_TIMEOUT_MS);

    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: ac.signal,
      });

      if (!res.ok) {
        logger.warn("KamailioRPC", `MI command ${command} failed: HTTP ${res.status}`);
        return null;
      }

      const body = await res.json().catch(() => null);
      logger.debug("KamailioRPC", `MI ${command} response: ${JSON.stringify(body)}`);
      return body;
    } catch (err) {
      logger.warn("KamailioRPC", `MI command ${command} error: ${String(err)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Reload dispatcher routing table from database */
  async dispatcherReload(): Promise<boolean> {
    const result = await this.mi("dispatcher.reload");
    return result !== null;
  }

  /** Set a dispatcher destination as active/inactive */
  async dispatcherSetState(groupId: number, uri: string, state: "active" | "inactive"): Promise<boolean> {
    const stateCode = state === "active" ? 0 : 1;
    const result = await this.mi("dispatcher.set_state", {
      _state: String(stateCode),
      group: String(groupId),
      address: uri,
    });
    if (result) {
      logger.info("KamailioRPC", `Dispatcher ${uri} in group ${groupId} set to ${state}`);
    }
    return result !== null;
  }

  /** Get dispatcher group list */
  async dispatcherList(): Promise<DispatcherEntry[]> {
    const result = await this.mi("dispatcher.list");
    if (!result) return [];
    try {
      return (result.RECORDS || []).flatMap((r: any) => {
        return (r.DEST || []).map((d: any) => ({
          id: r.SET?.ID || 0,
          uri: d.URI,
          flags: d.FLAGS || 0,
          priority: d.PRIORITY || 0,
          attrs: d.ATTRS || "",
          state: d.FLAGS === 0 ? "active" : d.FLAGS === 1 ? "inactive" : "probing",
        }));
      });
    } catch {
      return [];
    }
  }

  /** Force LCR reload from database */
  async lcrReload(): Promise<boolean> {
    const result = await this.mi("lcr.reload");
    return result !== null;
  }

  /** Get active SIP dialog count */
  async getDialogCount(): Promise<{ total: number; early: number; confirmed: number } | null> {
    const result = await this.mi("dialog.list");
    if (!result) return null;
    try {
      const dialogs: KamailioDialog[] = result.Dialogs || [];
      return {
        total: dialogs.length,
        early: dialogs.filter((d) => d.state === "early").length,
        confirmed: dialogs.filter((d) => d.state === "confirmed").length,
      };
    } catch {
      return null;
    }
  }

  /** Ping Kamailio (uses uptime MI command) */
  async ping(): Promise<{ healthy: boolean; uptimeSeconds?: number }> {
    const result = await this.mi("core.uptime");
    if (!result) return { healthy: false };
    return {
      healthy: true,
      uptimeSeconds: result["Now"] || result.uptime || 0,
    };
  }

  /** Kill a specific SIP dialog (emergency hangup) */
  async killDialog(callId: string, fromTag: string): Promise<boolean> {
    const result = await this.mi("dialog.kill_dlg", {
      callid: callId,
      from_tag: fromTag,
    });
    if (result) {
      logger.info("KamailioRPC", `Killed dialog callId=${callId}`);
    }
    return result !== null;
  }

  /** Get Kamailio statistics */
  async getStats(module?: string): Promise<Record<string, number> | null> {
    const params = module ? { statistics: `${module}:` } : { statistics: "all" };
    const result = await this.mi("stats.get_statistics", params);
    if (!result) return null;
    try {
      const out: Record<string, number> = {};
      for (const stat of result.Statistics || []) {
        const parts = String(stat).split(":");
        if (parts.length === 2) {
          out[parts[0].trim()] = parseFloat(parts[1].trim()) || 0;
        }
      }
      return out;
    } catch {
      return null;
    }
  }

  /** Add a trunk to the Kamailio dispatcher table dynamically */
  async addDispatcherDestination(groupId: number, uri: string, priority: number = 10): Promise<boolean> {
    // Kamailio dispatcher.add MI command (requires db_mode=0 or memory mode)
    const result = await this.mi("dispatcher.add", {
      group: String(groupId),
      address: uri,
      flags: "0",
      priority: String(priority),
      attrs: "",
    });
    if (result) {
      logger.info("KamailioRPC", `Added dispatcher destination: ${uri} to group ${groupId}`);
    }
    return result !== null;
  }
}

// Singleton
let _kamailioClient: KamailioRPCClient | null = null;

export function getKamailioClient(): KamailioRPCClient {
  if (!_kamailioClient) {
    _kamailioClient = new KamailioRPCClient();
  }
  return _kamailioClient;
}

import { NeuraTalkApiError, NeuraTalkNetworkError } from "./errors.js";
import type {
  AuthResult,
  CallHistoryEntry,
  CallSession,
  CreateCallInput,
  CreateConferenceCallInput,
  ExportFormat,
  NeuraTalkUser,
  OtpVerifyResult,
  TranscriptSearchPage,
  TranscriptSegment,
} from "./types.js";

export interface NeuraTalkClientOptions {
  /** Bearer session token from login/register/otp-verify. Omit for the unauthenticated auth endpoints. */
  token?: string;
  /** Defaults to https://neuratalk.in — override for self-hosted/staging deployments. */
  baseUrl?: string;
  /** Max retry attempts for network errors and 429/5xx responses. Defaults to 3. */
  maxRetries?: number;
  /** Base delay for exponential backoff between retries, in ms. Defaults to 300. */
  retryBaseDelayMs?: number;
  fetch?: typeof fetch;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Official NeuraTalk API client. Auth endpoints don't require a token;
 * everything else does — pass one via the constructor or `withToken()`.
 */
export class NeuraTalkClient {
  private token?: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NeuraTalkClientOptions = {}) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? "https://neuratalk.in").replace(/\/+$/, "");
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 300;
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new Error("No fetch implementation available — pass one via NeuraTalkClientOptions.fetch on Node < 18.");
    }
    this.fetchImpl = fetchImpl;
  }

  /** Returns a new client bound to the given session token, leaving this one unmodified. */
  withToken(token: string): NeuraTalkClient {
    return new NeuraTalkClient({
      token,
      baseUrl: this.baseUrl,
      maxRetries: this.maxRetries,
      retryBaseDelayMs: this.retryBaseDelayMs,
      fetch: this.fetchImpl,
    });
  }

  // ---- Auth ----

  async register(input: { username: string; password: string; email?: string; phone?: string; role?: string; organizationName?: string }): Promise<AuthResult> {
    return this.request<AuthResult>("POST", "/api/auth/register", { body: input, auth: false });
  }

  async login(username: string, password: string): Promise<AuthResult> {
    return this.request<AuthResult>("POST", "/api/auth/login", { body: { username, password }, auth: false });
  }

  async requestOtp(identifier: string, channel: "email" | "mobile"): Promise<{ success: boolean; message: string }> {
    return this.request("POST", "/api/auth/otp/request", { body: { identifier, channel }, auth: false });
  }

  async verifyOtp(identifier: string, channel: "email" | "mobile", code: string, firebaseToken?: string): Promise<OtpVerifyResult> {
    return this.request<OtpVerifyResult>("POST", "/api/auth/otp/verify", {
      body: { identifier, channel, code, firebaseToken },
      auth: false,
    });
  }

  async me(): Promise<NeuraTalkUser> {
    return this.request<NeuraTalkUser>("GET", "/api/auth/me");
  }

  async logout(): Promise<void> {
    await this.request("POST", "/api/auth/logout");
  }

  // ---- Calls ----

  async createCall(input: CreateCallInput): Promise<CallSession> {
    return this.request<CallSession>("POST", "/api/calls/create", { body: input });
  }

  async createConferenceCall(input: CreateConferenceCallInput): Promise<CallSession> {
    return this.request<CallSession>("POST", "/api/calls/conference", { body: input });
  }

  async connectCall(callId: string, receiverNumber?: string): Promise<unknown> {
    return this.request("POST", `/api/calls/${encodeURIComponent(callId)}/connect`, { body: { receiverNumber } });
  }

  async endCall(callId: string): Promise<unknown> {
    return this.request("POST", `/api/calls/${encodeURIComponent(callId)}/end`);
  }

  async holdCall(callId: string): Promise<unknown> {
    return this.request("POST", `/api/calls/${encodeURIComponent(callId)}/hold`);
  }

  async resumeCall(callId: string): Promise<unknown> {
    return this.request("DELETE", `/api/calls/${encodeURIComponent(callId)}/hold`);
  }

  async rejectCall(callId: string): Promise<unknown> {
    return this.request("POST", `/api/calls/${encodeURIComponent(callId)}/reject`);
  }

  async getIncomingCall(): Promise<CallSession | null> {
    const res = await this.request<{ incoming: CallSession | null }>("GET", "/api/calls/incoming");
    return res.incoming;
  }

  async listCallHistory(limit = 50): Promise<CallHistoryEntry[]> {
    const res = await this.request<{ calls: CallHistoryEntry[] }>("GET", `/api/calls/history?limit=${limit}`);
    return res.calls;
  }

  async getCall(callId: string): Promise<CallHistoryEntry> {
    return this.request<CallHistoryEntry>("GET", `/api/calls/${encodeURIComponent(callId)}`);
  }

  // ---- Transcripts ----

  async searchTranscripts(query: string, options: { limit?: number; offset?: number } = {}): Promise<TranscriptSearchPage> {
    const params = new URLSearchParams({ q: query });
    if (options.limit != null) params.set("limit", String(options.limit));
    if (options.offset != null) params.set("offset", String(options.offset));
    return this.request<TranscriptSearchPage>("GET", `/api/transcripts/search?${params.toString()}`);
  }

  async getTranscript(callId: string): Promise<TranscriptSegment[]> {
    const res = await this.request<{ callId: string; segments: TranscriptSegment[] }>(
      "GET",
      `/api/transcripts/${encodeURIComponent(callId)}`,
    );
    return res.segments;
  }

  async deleteTranscript(callId: string): Promise<{ success: boolean; deletedCount: number }> {
    return this.request("DELETE", `/api/transcripts/${encodeURIComponent(callId)}`);
  }

  /** Returns the raw exported file bytes — write them to disk or stream them as-is. */
  async exportTranscript(callId: string, format: ExportFormat): Promise<ArrayBuffer> {
    const res = await this.rawRequest("GET", `/api/transcripts/${encodeURIComponent(callId)}/export/${format}`);
    return res.arrayBuffer();
  }

  // ---- Internals ----

  private async request<T>(method: string, path: string, opts: { body?: unknown; auth?: boolean } = {}): Promise<T> {
    const res = await this.rawRequest(method, path, opts);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  private async rawRequest(method: string, path: string, opts: { body?: unknown; auth?: boolean } = {}): Promise<Response> {
    const { body, auth = true } = opts;
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && this.token) headers["Authorization"] = `Bearer ${this.token}`;

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt++;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (cause) {
        if (attempt > this.maxRetries) throw new NeuraTalkNetworkError(cause);
        await this.backoff(attempt);
        continue;
      }

      if (!res.ok) {
        if (RETRYABLE_STATUS.has(res.status) && attempt <= this.maxRetries) {
          await this.backoff(attempt, res.headers.get("Retry-After"));
          continue;
        }
        const errorBody = await this.safeParseJson(res);
        throw new NeuraTalkApiError(res.status, errorBody);
      }
      return res;
    }
  }

  private async safeParseJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return undefined;
    }
  }

  private async backoff(attempt: number, retryAfterHeader?: string | null): Promise<void> {
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
    const delay = retryAfterMs && !Number.isNaN(retryAfterMs) ? retryAfterMs : this.retryBaseDelayMs * 2 ** (attempt - 1);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

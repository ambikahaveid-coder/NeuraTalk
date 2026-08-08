/**
 * Raised for any non-2xx NeuraTalk API response. `body` is the parsed JSON
 * error payload — its exact shape varies by module (the API has no single
 * error envelope: auth returns {message}/{success,message}, calls/transcripts
 * return {error}). Check `code`/`message`/`error` defensively rather than
 * assuming one shape.
 */
export class NeuraTalkApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const message = NeuraTalkApiError.extractMessage(body) ?? `Request failed with status ${status}`;
    super(message);
    this.name = "NeuraTalkApiError";
    this.status = status;
    this.body = body;
  }

  private static extractMessage(body: unknown): string | undefined {
    if (body && typeof body === "object") {
      const b = body as Record<string, unknown>;
      if (typeof b.message === "string") return b.message;
      if (typeof b.error === "string") return b.error;
    }
    return undefined;
  }
}

export class NeuraTalkNetworkError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(`Network error while calling the NeuraTalk API: ${String(cause)}`);
    this.name = "NeuraTalkNetworkError";
    this.cause = cause;
  }
}

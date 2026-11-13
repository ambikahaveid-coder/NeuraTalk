/** apiRequest throws "403: {json}"; this returns the server's own sentence. */
export function serverMessage(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message.replace(/^\d+:\s*/, "") : "";
  try {
    const j = JSON.parse(raw);
    return j.error || j.message || fallback;
  } catch {
    return raw || fallback;
  }
}

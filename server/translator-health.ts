// Outcome of the most recent translator-bot starts, for the public status
// page. In memory only: one server task, and a restart starts clean.
let lastSuccessAt: number | null = null;
let lastFailureAt: number | null = null;

export function recordTranslatorStart(ok: boolean): void {
  if (ok) lastSuccessAt = Date.now();
  else lastFailureAt = Date.now();
}

// Degraded when the latest start failed within the last hour.
export function translatorHealth(): { status: "operational" | "degraded"; message?: string } {
  const recentFailure = lastFailureAt !== null && Date.now() - lastFailureAt < 60 * 60 * 1000;
  if (recentFailure && (lastSuccessAt === null || lastFailureAt! > lastSuccessAt)) {
    return { status: "degraded", message: "Recent calls connected without translation" };
  }
  return { status: "operational" };
}

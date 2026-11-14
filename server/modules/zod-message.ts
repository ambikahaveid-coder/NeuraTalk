import type { ZodError } from "zod";

/**
 * One readable line for an API error, e.g. "buttons.0.code: A code has no spaces",
 * instead of zod's raw JSON dump. Developers using the API read this.
 */
export function zodMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

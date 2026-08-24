// Minimal email normalization -- no existing normalizer was found in the
// codebase (see Phase 4 audit, docs/neura-ecosystem/29). Deliberately does
// NOT validate email format (that's the caller's job, e.g. zod's .email());
// this only makes two different-cased/whitespace-padded entries of the same
// address compare equal for deduplication purposes.
export function normalizeEmail(input: string | null | undefined): string {
  const raw = String(input ?? "").trim().toLowerCase();
  return raw;
}

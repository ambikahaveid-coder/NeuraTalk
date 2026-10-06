/**
 * P0-4: shared consent predicate used by both personal-chat-routes.ts and
 * group-chats.ts so the same opt-out semantics apply everywhere translation
 * is triggered from a chat send, not re-implemented per call site.
 *
 * Opt-out semantics (not strict opt-in). users.consentTranslation defaults
 * to false in the schema, and neither the mobile nor the web app ever calls
 * /api/compliance/consent, so `false` on its own almost always means "never
 * asked", not "said no". Treating that default as a refusal blocked chat
 * translation for every user. A refusal only counts when the user actually
 * recorded a consent choice, which /api/compliance/consent stamps in
 * users.consentTimestamp.
 */
export function isTranslationConsentDenied(
  consentTranslation: boolean | null | undefined,
  consentTimestamp: Date | string | null | undefined,
): boolean {
  return consentTranslation === false && consentTimestamp != null;
}

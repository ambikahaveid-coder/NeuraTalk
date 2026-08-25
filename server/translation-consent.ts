/**
 * P0-4: shared consent predicate used by both personal-chat-routes.ts and
 * group-chats.ts so the same opt-out semantics apply everywhere translation
 * is triggered from a chat send, not re-implemented per call site.
 *
 * Opt-out semantics (not strict opt-in): users.consentTranslation defaults
 * to false in the schema and, before this fix, was never read anywhere --
 * no existing user has ever explicitly set it. Gating strictly on `=== true`
 * would silently stop translation for the entire existing user base on
 * deploy. Instead, only an EXPLICIT false blocks translation -- unset/true
 * both pass -- mirroring how the sibling `translationEnabled` toggle is
 * already checked in this codebase. An explicit revocation now actually
 * takes effect for the first time; nothing already working changes.
 */
export function isTranslationConsentDenied(consentTranslation: boolean | null | undefined): boolean {
  return consentTranslation === false;
}

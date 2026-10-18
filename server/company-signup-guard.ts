import { USER_ROLES } from "@shared/schema";

/**
 * Company signup needs no login, so an account that already exists for the
 * submitted email may only be turned into a company admin by its own
 * signed-in owner, and only while it is a plain consumer account. Returns
 * the reason to refuse, or null when signup may use the existing account.
 */
export function existingAccountSignupRefusal(
  existingUser: { id: number; role: string; organizationId: number | null } | undefined,
  requesterId: number | undefined,
): string | null {
  if (!existingUser) return null;
  if (requesterId !== existingUser.id) {
    return "An account with this email already exists. Sign in with it first, then register your company.";
  }
  if (existingUser.role !== USER_ROLES.CONSUMER || existingUser.organizationId) {
    return "This account already belongs to an organization. Use a different email to register a new company.";
  }
  return null;
}

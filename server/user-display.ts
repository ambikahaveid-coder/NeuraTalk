/**
 * The name other people see for a user: their chosen profile name
 * (display_name, not unique), else their unique username, email or phone.
 */
export function publicName(
  user: { displayName?: string | null; username?: string | null; email?: string | null; phone?: string | null } | null | undefined,
  fallback = "Unknown user",
): string {
  return user?.displayName?.trim() || user?.username || user?.email || user?.phone || fallback;
}

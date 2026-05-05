export function normalizeTenantSlug(value?: string | null): string | null {
  return value?.trim() ? value.trim().toLowerCase() : null;
}

export function usesFirebasePhoneOtp(env: NodeJS.ProcessEnv = process.env): boolean {
  const provider = (
    env.PHONE_OTP_PROVIDER ||
    env.VITE_PHONE_OTP_PROVIDER ||
    "firebase"
  ).toLowerCase();

  return provider === "firebase";
}

const NON_DIGIT_REGEX = /\D/g;
const DEFAULT_DIAL_CODE = "+91";

function extractPhoneDigits(input: string | null | undefined): string {
  return String(input ?? "").replace(NON_DIGIT_REGEX, "");
}

export function normalizePhoneNumber(input: string | null | undefined, defaultDialCode = DEFAULT_DIAL_CODE): string {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return "";
  }

  if (raw.startsWith("+")) {
    const digits = extractPhoneDigits(raw);
    return digits ? `+${digits}` : "";
  }

  if (raw.startsWith("00")) {
    const digits = extractPhoneDigits(raw).replace(/^00/, "");
    return digits ? `+${digits}` : "";
  }

  const digits = extractPhoneDigits(raw);
  if (!digits) {
    return "";
  }

  if (digits.length >= 11) {
    return `+${digits}`;
  }

  return `${defaultDialCode}${digits}`;
}

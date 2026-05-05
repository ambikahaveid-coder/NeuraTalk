import { DEFAULT_COUNTRY_CODE, getCountryByCode } from "./countries";

const NON_DIGIT_REGEX = /\D/g;

export function extractPhoneDigits(input: string | null | undefined): string {
  return String(input ?? "").replace(NON_DIGIT_REGEX, "");
}

function normalizeDialCode(value: string | null | undefined): string {
  const digits = extractPhoneDigits(value);
  return digits ? `+${digits}` : "";
}

function resolveDefaultDialCode(defaultCountryCode?: string | null, defaultDialCode?: string | null): string {
  if (defaultDialCode) {
    return normalizeDialCode(defaultDialCode);
  }

  if (defaultCountryCode) {
    const country = getCountryByCode(defaultCountryCode.toUpperCase());
    if (country?.dialCode) {
      return normalizeDialCode(country.dialCode);
    }
  }

  const fallbackCountry = getCountryByCode(DEFAULT_COUNTRY_CODE);
  return normalizeDialCode(fallbackCountry?.dialCode || "+91");
}

export function normalizePhoneNumber(
  input: string | null | undefined,
  options?: string | {
    defaultCountryCode?: string | null;
    defaultDialCode?: string | null;
  },
): string {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return "";
  }

  const defaultDialCode = typeof options === "string"
    ? normalizeDialCode(options)
    : resolveDefaultDialCode(options?.defaultCountryCode, options?.defaultDialCode);

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

  // If the user entered an international-length number without `+`,
  // preserve it as E.164 instead of forcing the default country.
  if (digits.length >= 11) {
    return `+${digits}`;
  }

  return `${defaultDialCode}${digits}`;
}

export function normalizePhoneForCountry(
  input: string | null | undefined,
  countryCode: string,
): string {
  return normalizePhoneNumber(input, { defaultCountryCode: countryCode });
}

export function normalizePhoneForIndia(input: string | null | undefined): string {
  return normalizePhoneForCountry(input, "IN");
}

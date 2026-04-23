export interface CountryData {
  code: string;
  name: string;
  dialCode: string;
  phoneLength: number;
  flag: string;
}

export const countries: CountryData[] = [
  { code: "IN", name: "India", dialCode: "+91", phoneLength: 10, flag: "🇮🇳" },
  { code: "US", name: "United States", dialCode: "+1", phoneLength: 10, flag: "🇺🇸" },
  { code: "GB", name: "United Kingdom", dialCode: "+44", phoneLength: 10, flag: "🇬🇧" },
  { code: "AE", name: "UAE", dialCode: "+971", phoneLength: 9, flag: "🇦🇪" },
  { code: "SA", name: "Saudi Arabia", dialCode: "+966", phoneLength: 9, flag: "🇸🇦" },
  { code: "SG", name: "Singapore", dialCode: "+65", phoneLength: 8, flag: "🇸🇬" },
  { code: "AU", name: "Australia", dialCode: "+61", phoneLength: 9, flag: "🇦🇺" },
  { code: "CA", name: "Canada", dialCode: "+1", phoneLength: 10, flag: "🇨🇦" },
  { code: "DE", name: "Germany", dialCode: "+49", phoneLength: 11, flag: "🇩🇪" },
  { code: "FR", name: "France", dialCode: "+33", phoneLength: 9, flag: "🇫🇷" },
  { code: "JP", name: "Japan", dialCode: "+81", phoneLength: 10, flag: "🇯🇵" },
  { code: "KR", name: "South Korea", dialCode: "+82", phoneLength: 10, flag: "🇰🇷" },
  { code: "CN", name: "China", dialCode: "+86", phoneLength: 11, flag: "🇨🇳" },
  { code: "BR", name: "Brazil", dialCode: "+55", phoneLength: 11, flag: "🇧🇷" },
  { code: "MX", name: "Mexico", dialCode: "+52", phoneLength: 10, flag: "🇲🇽" },
  { code: "NZ", name: "New Zealand", dialCode: "+64", phoneLength: 9, flag: "🇳🇿" },
  { code: "ZA", name: "South Africa", dialCode: "+27", phoneLength: 9, flag: "🇿🇦" },
  { code: "MY", name: "Malaysia", dialCode: "+60", phoneLength: 10, flag: "🇲🇾" },
  { code: "PH", name: "Philippines", dialCode: "+63", phoneLength: 10, flag: "🇵🇭" },
  { code: "TH", name: "Thailand", dialCode: "+66", phoneLength: 9, flag: "🇹🇭" },
  { code: "ID", name: "Indonesia", dialCode: "+62", phoneLength: 11, flag: "🇮🇩" },
  { code: "PK", name: "Pakistan", dialCode: "+92", phoneLength: 10, flag: "🇵🇰" },
  { code: "BD", name: "Bangladesh", dialCode: "+880", phoneLength: 10, flag: "🇧🇩" },
  { code: "LK", name: "Sri Lanka", dialCode: "+94", phoneLength: 9, flag: "🇱🇰" },
  { code: "NP", name: "Nepal", dialCode: "+977", phoneLength: 10, flag: "🇳🇵" },
];

export const DEFAULT_COUNTRY_CODE = "IN";

export function getCountryByCode(code: string): CountryData | undefined {
  return countries.find((c) => c.code === code);
}

export function getCountryByDialCode(dialCode: string): CountryData | undefined {
  return countries.find((c) => c.dialCode === dialCode);
}

export function validatePhoneNumber(phone: string, countryCode: string): { valid: boolean; message?: string } {
  const country = getCountryByCode(countryCode);
  if (!country) {
    return { valid: false, message: "Invalid country" };
  }

  const digitsOnly = phone.replace(/\D/g, "");
  
  if (digitsOnly.length === 0) {
    return { valid: false, message: "Phone number is required" };
  }
  
  if (digitsOnly.length < country.phoneLength) {
    return { valid: false, message: `Enter ${country.phoneLength} digits` };
  }
  
  if (digitsOnly.length > country.phoneLength) {
    return { valid: false, message: `Maximum ${country.phoneLength} digits allowed` };
  }

  return { valid: true };
}

export function formatPhoneWithCountryCode(phone: string, countryCode: string): string {
  const country = getCountryByCode(countryCode);
  if (!country) return phone;
  
  const digitsOnly = phone.replace(/\D/g, "");
  return `${country.dialCode}${digitsOnly}`;
}

export function sanitizePhoneInput(input: string, maxLength: number): string {
  const digitsOnly = input.replace(/\D/g, "");
  return digitsOnly.slice(0, maxLength);
}

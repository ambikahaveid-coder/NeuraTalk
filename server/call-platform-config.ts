function isEnabled(value: string | undefined, defaultValue = false): boolean {
  if (!value) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function isLegacyTwilioBridgeEnabled(): boolean {
  return isEnabled(process.env.ENABLE_LEGACY_TWILIO_BRIDGE, false);
}


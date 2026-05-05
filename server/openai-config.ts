const MOCK_OPENAI_PATTERNS = [
  /^sk-mock-/i,
  /^mock_/i,
  /placeholder/i,
  /^changeme$/i,
  /^replace_me$/i,
] as const;

export function getOpenAIKey(): string | null {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
  return key.trim() ? key.trim() : null;
}

export function isMockOpenAIKey(value?: string | null): boolean {
  if (!value) {
    return true;
  }

  return MOCK_OPENAI_PATTERNS.some((pattern) => pattern.test(value));
}

export function hasWorkingOpenAIKey(): boolean {
  const key = getOpenAIKey();
  return !!key && !isMockOpenAIKey(key);
}


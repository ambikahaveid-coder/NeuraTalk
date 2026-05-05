export type JoinMethod = "app_to_app" | "app_to_pstn" | "conference";
export type CallType = "voice" | "video";

export function resolveEffectiveCallMode(
  joinMethod: JoinMethod,
  requestedCallType: CallType,
  enableLipsync?: boolean,
): { effectiveCallType: CallType; effectiveLipsync: boolean } {
  return {
    effectiveCallType: joinMethod === "app_to_pstn" ? "voice" : requestedCallType,
    effectiveLipsync: joinMethod === "app_to_pstn" ? false : !!enableLipsync,
  };
}

export function resolveTranslationEnabled(options: {
  callerLanguage?: string | null;
  calleeLanguage?: string | null;
  requestedTranslationEnabled?: boolean;
}): boolean {
  const callerLanguage = (options.callerLanguage || "auto").trim().toLowerCase() || "auto";
  const calleeLanguage = (options.calleeLanguage || "auto").trim().toLowerCase() || "auto";
  const inferredTranslationEnabled = callerLanguage === "auto" || calleeLanguage === "auto"
    ? true
    : calleeLanguage !== callerLanguage;

  return typeof options.requestedTranslationEnabled === "boolean"
    ? options.requestedTranslationEnabled
    : inferredTranslationEnabled;
}

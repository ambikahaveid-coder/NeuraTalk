import type { JoinMethod } from "./call-behavior";

export type CallerIdentityMode =
  | "app_identity"
  | "organization_caller_id"
  | "user_verified_number"
  | "provider_caller_id";

export function resolveRequestedJoinMethod(options: {
  transportPreference?: "app_to_app" | "app_to_pstn" | "auto" | null;
  calleeHasApp: boolean;
  calleeUserId?: string | null;
}): JoinMethod {
  if (options.transportPreference === "app_to_pstn") {
    return "app_to_pstn";
  }

  if (options.transportPreference === "app_to_app") {
    return "app_to_app";
  }

  return options.calleeHasApp && options.calleeUserId
    ? "app_to_app"
    : "app_to_pstn";
}

export function resolveCallerIdentityMode(options: {
  joinMethod: JoinMethod;
  organizationCallerId?: string | null;
  callerVerifiedNumber?: string | null;
  callerPhoneVerified?: boolean;
}): CallerIdentityMode {
  if (options.joinMethod !== "app_to_pstn") {
    return "app_identity";
  }

  if (options.organizationCallerId) {
    return "organization_caller_id";
  }

  if (options.callerPhoneVerified && options.callerVerifiedNumber) {
    return "user_verified_number";
  }

  return "provider_caller_id";
}

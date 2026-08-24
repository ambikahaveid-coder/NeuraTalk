/**
 * OTP-safe template rendering -- Phase 6 (2026-08-24).
 * See docs/neura-ecosystem/31_BUSINESS_OTP_AUTHENTICATION_IMPLEMENTATION.md
 * section 17.
 *
 * Reuses Phase 2's safe, deterministic single-pass renderer (../templates/
 * render.ts) -- no second template engine. The ONLY OTP-specific rule
 * added here: the {{code}} placeholder is NEVER substituted with the real
 * code in anything that gets persisted to a database column, logged, or
 * returned in an API response. `renderRedactedForRecord` is the only
 * rendering path this module ever writes to storage with -- there is no
 * function anywhere in this module that renders the real code into a
 * string and then saves or logs that string.
 */
import { renderTemplateContent, type RenderResult } from "../templates/render";
import type { TemplateVariableDeclaration } from "@shared/schema";

export const REDACTION_MARKER = "[code sent separately]";

const SUPPORTED_OTP_VARIABLES = new Set(["code", "name"]);

export class UnsupportedOtpVariableError extends Error {
  constructor(name: string) {
    super(`Template declares unsupported variable "${name}" -- OTP templates currently only support {{code}} and {{name}}`);
    this.name = "UnsupportedOtpVariableError";
  }
}
export class OtpTemplateMissingCodeError extends Error {
  constructor() {
    super('OTP template must declare a required "code" variable');
    this.name = "OtpTemplateMissingCodeError";
  }
}

/** Bind-time validation -- called when a template is attached to OTP sending, not per-send. */
export function assertOtpTemplateShape(declarations: TemplateVariableDeclaration[]): void {
  for (const decl of declarations) {
    if (!SUPPORTED_OTP_VARIABLES.has(decl.name)) {
      throw new UnsupportedOtpVariableError(decl.name);
    }
  }
  const codeDecl = declarations.find((d) => d.name === "code");
  if (!codeDecl || !codeDecl.required) {
    throw new OtpTemplateMissingCodeError();
  }
}

/**
 * The ONLY rendering path used for anything that gets stored (the
 * conversational messagingMessages.content record). {{code}} is always
 * REDACTION_MARKER here, regardless of what the real code is -- this
 * function doesn't even take the real code as a parameter, so it is
 * structurally impossible for it to leak it.
 */
export function renderRedactedForRecord(content: string, declarations: TemplateVariableDeclaration[], customerName: string | null): RenderResult {
  const values: Record<string, unknown> = { code: REDACTION_MARKER };
  if (customerName && declarations.some((d) => d.name === "name")) {
    values.name = customerName;
  }
  return renderTemplateContent(content, declarations, values);
}

/** Default content when no business template is bound -- still never returned/logged, only used to prove the render path works end to end (nothing consumes its output in this phase, since no provider is called). */
export const DEFAULT_OTP_VARIABLES: TemplateVariableDeclaration[] = [{ name: "code", type: "text", required: true }];
export const DEFAULT_OTP_CONTENT = "Your verification code is {{code}}. It expires shortly. Do not share this code with anyone.";

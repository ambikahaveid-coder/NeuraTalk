/**
 * Safe, deterministic template rendering -- Phase 2 (2026-08-24).
 * See docs/neura-ecosystem/27_BUSINESS_TEMPLATE_ENGINE_IMPLEMENTATION.md
 * section 10.
 *
 * No code execution of any kind. Rendering is a single-pass literal
 * find-and-replace over {{variable_name}} tokens -- not a template engine
 * with expression evaluation (no Handlebars/EJS/etc), so there is no
 * mechanism for a variable's VALUE to be interpreted as a new placeholder,
 * a JS expression, a SQL fragment, or an HTML/script tag. String.replace
 * with a static replacer function scans the ORIGINAL string once; text
 * introduced by a replacement is never re-scanned for further
 * placeholders, so a malicious variable VALUE containing "{{...}}" cannot
 * inject a second-order substitution.
 */
import { TEMPLATE_VARIABLE_TYPE, type TemplateVariableDeclaration } from "@shared/schema";

const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
const MAX_CONTENT_LENGTH = 4096;
const MAX_VARIABLE_COUNT = 20;
const MAX_VARIABLE_VALUE_LENGTH = 500;
const NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export class TemplateContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateContentError";
  }
}
export class TemplateRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateRenderError";
  }
}

/** Every {{token}} that actually appears in the content, as a Set (de-duplicated). */
function extractPlaceholders(content: string): Set<string> {
  const found = new Set<string>();
  for (const match of Array.from(content.matchAll(PLACEHOLDER_PATTERN))) {
    found.add(match[1]);
  }
  return found;
}

/**
 * Validates template CONTENT + its declared variables at save time (not
 * render time) -- every {{token}} in the body must be declared, every
 * declared variable name must be well-formed, and the content must not
 * contain a malformed/unterminated placeholder (a bare "{{" or "}}" with
 * no matching well-formed pair, or an empty "{{}}").
 */
export function validateTemplateContent(content: string, declarations: TemplateVariableDeclaration[]): void {
  if (!content || !content.trim()) {
    throw new TemplateContentError("Content must not be empty");
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new TemplateContentError(`Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(content)) {
    throw new TemplateContentError("Content contains unsafe control characters");
  }

  if (declarations.length > MAX_VARIABLE_COUNT) {
    throw new TemplateContentError(`Too many declared variables (max ${MAX_VARIABLE_COUNT})`);
  }
  const declaredNames = new Set<string>();
  for (const decl of declarations) {
    if (!NAME_PATTERN.test(decl.name)) {
      throw new TemplateContentError(`Invalid variable name: ${decl.name}`);
    }
    if (declaredNames.has(decl.name)) {
      throw new TemplateContentError(`Duplicate variable declaration: ${decl.name}`);
    }
    if (!Object.values(TEMPLATE_VARIABLE_TYPE).includes(decl.type)) {
      throw new TemplateContentError(`Invalid variable type for ${decl.name}: ${decl.type}`);
    }
    declaredNames.add(decl.name);
  }

  // Malformed placeholder detection: any "{{" or "}}" that isn't part of a
  // well-formed {{name}} token. Strip well-formed tokens first, then check
  // for leftover brace pairs.
  const withoutWellFormed = content.replace(PLACEHOLDER_PATTERN, "");
  if (withoutWellFormed.includes("{{") || withoutWellFormed.includes("}}")) {
    throw new TemplateContentError("Content contains a malformed placeholder");
  }

  // Every {{token}} actually used in the content must be declared -- no
  // undeclared variables silently pass at save time either.
  const used = extractPlaceholders(content);
  for (const name of Array.from(used)) {
    if (!declaredNames.has(name)) {
      throw new TemplateContentError(`Placeholder {{${name}}} is used but not declared as a variable`);
    }
  }
}

export interface RenderResult {
  rendered: string;
}

/**
 * Renders a version's content against caller-supplied variable values.
 * Rejects: missing required variables, wrong types, and any supplied key
 * that isn't declared (no silent pass-through). Deterministic -- same
 * inputs always produce the same output, no side effects.
 */
export function renderTemplateContent(
  content: string,
  declarations: TemplateVariableDeclaration[],
  values: Record<string, unknown>,
): RenderResult {
  const declaredByName = new Map(declarations.map((d) => [d.name, d]));

  for (const key of Object.keys(values)) {
    if (!declaredByName.has(key)) {
      throw new TemplateRenderError(`Unknown variable supplied: ${key}`);
    }
  }

  const stringValues = new Map<string, string>();
  for (const decl of declarations) {
    const raw = values[decl.name];
    if (raw === undefined || raw === null || raw === "") {
      if (decl.required) {
        throw new TemplateRenderError(`Missing required variable: ${decl.name}`);
      }
      continue;
    }
    stringValues.set(decl.name, validateAndStringify(decl, raw));
  }

  const rendered = content.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
    // Every token in content was already proven declared at save time
    // (validateTemplateContent), so a missing entry here can only mean an
    // optional variable with no value supplied -- render as empty string,
    // never as the literal "{{name}}" (which could look like an
    // unresolved/broken message) and never by throwing (optional means
    // optional).
    return stringValues.get(name) ?? "";
  });

  return { rendered };
}

function validateAndStringify(decl: TemplateVariableDeclaration, raw: unknown): string {
  if (decl.type === TEMPLATE_VARIABLE_TYPE.NUMBER) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new TemplateRenderError(`Variable ${decl.name} must be a number`);
    }
    return String(raw);
  }
  if (decl.type === TEMPLATE_VARIABLE_TYPE.DATE) {
    const asDate = raw instanceof Date ? raw : new Date(String(raw));
    if (Number.isNaN(asDate.getTime())) {
      throw new TemplateRenderError(`Variable ${decl.name} must be a valid date`);
    }
    return asDate.toISOString();
  }
  // TEXT
  if (typeof raw !== "string") {
    throw new TemplateRenderError(`Variable ${decl.name} must be a string`);
  }
  if (raw.length > MAX_VARIABLE_VALUE_LENGTH) {
    throw new TemplateRenderError(`Variable ${decl.name} exceeds maximum length of ${MAX_VARIABLE_VALUE_LENGTH} characters`);
  }
  return raw;
}

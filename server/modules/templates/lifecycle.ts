/**
 * Template version lifecycle -- Phase 2 (2026-08-24).
 * See docs/neura-ecosystem/27_BUSINESS_TEMPLATE_ENGINE_IMPLEMENTATION.md
 * section 7 for the full reasoning, including why this reconciles doc 23's
 * originally-sketched longer lifecycle (DRAFT/SUBMITTED/UNDER_REVIEW/
 * APPROVED/PUBLISHED/PAUSED/ARCHIVED) down to the 5 states specified in
 * this phase's approval: UNDER_REVIEW is folded into SUBMITTED (a
 * submitted version IS under review until decided), PUBLISHED/PAUSED are
 * deferred to the Campaign phase (Phase 5) which doesn't exist yet -- this
 * phase only needs APPROVED as the terminal "usable" state.
 *
 * Same pattern as server/modules/b2b-admin/org-lifecycle.ts (Phase 1's
 * organization lifecycle) -- a LEGAL_TRANSITIONS map + a guard function,
 * not a new state-machine abstraction invented for this module.
 */
import { TEMPLATE_VERSION_STATUS, type TemplateVersionStatus } from "@shared/schema";

const LEGAL_TRANSITIONS: Record<TemplateVersionStatus, TemplateVersionStatus[]> = {
  [TEMPLATE_VERSION_STATUS.DRAFT]: [TEMPLATE_VERSION_STATUS.SUBMITTED, TEMPLATE_VERSION_STATUS.ARCHIVED],
  [TEMPLATE_VERSION_STATUS.SUBMITTED]: [TEMPLATE_VERSION_STATUS.APPROVED, TEMPLATE_VERSION_STATUS.REJECTED],
  [TEMPLATE_VERSION_STATUS.APPROVED]: [TEMPLATE_VERSION_STATUS.ARCHIVED], // immutable content; only path onward is archive or a NEW version
  [TEMPLATE_VERSION_STATUS.REJECTED]: [TEMPLATE_VERSION_STATUS.DRAFT, TEMPLATE_VERSION_STATUS.ARCHIVED],
  [TEMPLATE_VERSION_STATUS.ARCHIVED]: [], // terminal
};

export class IllegalTemplateTransitionError extends Error {
  constructor(public readonly from: TemplateVersionStatus, public readonly to: TemplateVersionStatus) {
    super(`Illegal template version transition: ${from} -> ${to}`);
    this.name = "IllegalTemplateTransitionError";
  }
}

export function assertLegalTemplateTransition(from: TemplateVersionStatus, to: TemplateVersionStatus): void {
  const allowed = LEGAL_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new IllegalTemplateTransitionError(from, to);
  }
}

/** Content (content/title/variables/media) is mutable ONLY while a version is DRAFT. */
export function isContentMutable(status: TemplateVersionStatus): boolean {
  return status === TEMPLATE_VERSION_STATUS.DRAFT;
}

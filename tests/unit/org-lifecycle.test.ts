import { describe, it, expect } from "vitest";
import {
  ORG_STATE,
  mapStoredStatusToOrgState,
  assertLegalTransition,
  IllegalOrgTransitionError,
} from "../../server/modules/b2b-admin/org-lifecycle";

describe("mapStoredStatusToOrgState", () => {
  it("maps pending -> PENDING_APPROVAL", () => {
    expect(mapStoredStatusToOrgState("pending", false)).toBe(ORG_STATE.PENDING_APPROVAL);
  });

  it("maps approved + isActive -> ACTIVE (existing rows: approval has always meant operational)", () => {
    expect(mapStoredStatusToOrgState("approved", true)).toBe(ORG_STATE.ACTIVE);
    expect(mapStoredStatusToOrgState("approved", null)).toBe(ORG_STATE.ACTIVE);
  });

  it("maps approved + isActive===false -> APPROVED (pre-activation edge case)", () => {
    expect(mapStoredStatusToOrgState("approved", false)).toBe(ORG_STATE.APPROVED);
  });

  it("maps suspended -> SUSPENDED", () => {
    expect(mapStoredStatusToOrgState("suspended", false)).toBe(ORG_STATE.SUSPENDED);
  });

  it("maps deactivated -> DEACTIVATED", () => {
    expect(mapStoredStatusToOrgState("deactivated", false)).toBe(ORG_STATE.DEACTIVATED);
  });

  it("maps rejected -> REJECTED", () => {
    expect(mapStoredStatusToOrgState("rejected", false)).toBe(ORG_STATE.REJECTED);
  });

  it("maps null/unknown status -> DRAFT", () => {
    expect(mapStoredStatusToOrgState(null, null)).toBe(ORG_STATE.DRAFT);
    expect(mapStoredStatusToOrgState("something_unexpected", null)).toBe(ORG_STATE.DRAFT);
  });
});

describe("assertLegalTransition", () => {
  const legalPairs: Array<[keyof typeof ORG_STATE, keyof typeof ORG_STATE]> = [
    ["PENDING_APPROVAL", "APPROVED"],
    ["PENDING_APPROVAL", "REJECTED"],
    ["APPROVED", "ACTIVE"],
    ["ACTIVE", "SUSPENDED"],
    ["ACTIVE", "DEACTIVATED"],
    ["SUSPENDED", "ACTIVE"],
  ];

  it.each(legalPairs)("allows %s -> %s", (from, to) => {
    expect(() => assertLegalTransition(ORG_STATE[from], ORG_STATE[to])).not.toThrow();
  });

  const illegalPairs: Array<[keyof typeof ORG_STATE, keyof typeof ORG_STATE]> = [
    ["PENDING_APPROVAL", "ACTIVE"], // must go through APPROVED first (conceptually)
    ["PENDING_APPROVAL", "SUSPENDED"],
    ["APPROVED", "SUSPENDED"], // must reach ACTIVE first
    ["SUSPENDED", "DEACTIVATED"], // not a modeled transition in this phase
    ["DEACTIVATED", "ACTIVE"], // terminal: no reactivation route in this phase
    ["REJECTED", "PENDING_APPROVAL"], // terminal: no resubmission route
    ["REJECTED", "ACTIVE"],
    ["ACTIVE", "PENDING_APPROVAL"], // no arbitrary backward transition
    ["ACTIVE", "ACTIVE"], // no-op transition is not "legal" (must be a real state change)
  ];

  it.each(illegalPairs)("rejects %s -> %s", (from, to) => {
    expect(() => assertLegalTransition(ORG_STATE[from], ORG_STATE[to])).toThrow(IllegalOrgTransitionError);
  });

  it("illegal transitions never allow arbitrary status changes: DEACTIVATED and REJECTED have zero legal outbound transitions", () => {
    for (const target of Object.values(ORG_STATE)) {
      expect(() => assertLegalTransition(ORG_STATE.DEACTIVATED, target)).toThrow();
      expect(() => assertLegalTransition(ORG_STATE.REJECTED, target)).toThrow();
    }
  });
});

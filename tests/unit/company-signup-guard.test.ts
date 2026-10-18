import { describe, expect, it } from "vitest";
import { existingAccountSignupRefusal } from "../../server/company-signup-guard";

const consumer = { id: 7, role: "consumer", organizationId: null };

describe("existingAccountSignupRefusal", () => {
  it("allows signup when no account uses the email", () => {
    expect(existingAccountSignupRefusal(undefined, undefined)).toBeNull();
  });

  it("refuses an anonymous signup that names someone else's email", () => {
    expect(existingAccountSignupRefusal(consumer, undefined)).toMatch(/already exists/);
  });

  it("refuses a signed-in user claiming a different account's email", () => {
    expect(existingAccountSignupRefusal(consumer, 99)).toMatch(/already exists/);
  });

  it("lets the signed-in owner of a consumer account register a company", () => {
    expect(existingAccountSignupRefusal(consumer, 7)).toBeNull();
  });

  it("never converts a super admin or an account already in an organization", () => {
    expect(existingAccountSignupRefusal({ id: 1, role: "super_admin", organizationId: null }, 1)).toMatch(/already belongs/);
    expect(existingAccountSignupRefusal({ id: 7, role: "consumer", organizationId: 4 }, 7)).toMatch(/already belongs/);
    expect(existingAccountSignupRefusal({ id: 8, role: "company_admin", organizationId: 2 }, 8)).toMatch(/already belongs/);
  });
});

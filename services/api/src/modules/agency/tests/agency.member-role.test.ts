import { describe, expect, it } from "vitest";
import {
  MEMBER_ROLE,
  STORED_MEMBER_ROLE,
  toApiMemberRole,
  toStoredMemberRole,
} from "@/modules/agency/constants/agency.constants.js";

describe("member role mapping", () => {
  it("maps each API value to its stored value", () => {
    expect(toStoredMemberRole("AGENCY_MEMBER")).toBe("Agency member");
    expect(toStoredMemberRole("BUSINESS_MANAGER")).toBe("Business manager");
  });

  it.each(Object.values(MEMBER_ROLE))("round-trips %s", (role) => {
    expect(toApiMemberRole(toStoredMemberRole(role))).toBe(role);
    expect(toApiMemberRole(STORED_MEMBER_ROLE[role])).toBe(role);
  });

  it("leaves an unknown stored value unchanged", () => {
    expect(toApiMemberRole("Founder")).toBe("Founder");
  });
});

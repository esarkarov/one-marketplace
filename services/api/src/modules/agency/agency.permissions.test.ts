import { describe, expect, it } from "vitest";
import {
  AGENCY_PERMISSIONS,
  isAgencyRoleAllowed,
  type AgencyPermission,
} from "./agency.permissions.js";

const permissions = Object.keys(AGENCY_PERMISSIONS) as AgencyPermission[];

describe("isAgencyRoleAllowed", () => {
  it.each(permissions)(
    "allows the owner and Business manager for %s",
    (key) => {
      expect(isAgencyRoleAllowed(key, { isOwner: true, role: "" })).toBe(true);
      expect(isAgencyRoleAllowed(key, { isOwner: true, role: "Founder" })).toBe(
        true,
      );
      expect(
        isAgencyRoleAllowed(key, { isOwner: false, role: "Business manager" }),
      ).toBe(true);
    },
  );

  it.each(permissions)("denies every other member role for %s", (key) => {
    for (const role of [
      "Agency member",
      "Founder",
      "Intern",
      "owner",
      "Owner",
      "business manager",
      "Business manager ",
      "BUSINESS MANAGER",
      "",
    ]) {
      expect(isAgencyRoleAllowed(key, { isOwner: false, role })).toBe(false);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  agencyPortfolioFolder,
  freelancerPortfolioFolder,
  jobAttachmentFolder,
  messageAttachmentFolder,
} from "./storage-paths.js";

const CLERK_ID = "user_2abcClerk";
const PUBLIC_ID = "7d6f6c0e-3c0a-4b53-8f33-0b2f6f1a9c11";

describe("storage path builders", () => {
  it("builds the message attachment folder from the accounts id", () => {
    expect(messageAttachmentFolder("conv-1", PUBLIC_ID)).toBe(
      `/onemarketplace/messages/conv-1/${PUBLIC_ID}`,
    );
  });

  it("builds the job attachment folder from the accounts id", () => {
    expect(jobAttachmentFolder(PUBLIC_ID)).toBe(PUBLIC_ID);
  });

  it("builds the freelancer portfolio folder from the accounts id", () => {
    expect(freelancerPortfolioFolder(PUBLIC_ID)).toBe(
      `/onemarketplace/freelancer-portfolios/${PUBLIC_ID}`,
    );
  });

  it("builds the agency portfolio folder from the agency id", () => {
    expect(agencyPortfolioFolder(PUBLIC_ID)).toBe(
      `/onemarketplace/agency-portfolios/${PUBLIC_ID}`,
    );
  });

  it("never contains a Clerk id", () => {
    for (const folder of [
      messageAttachmentFolder("conv-1", PUBLIC_ID),
      jobAttachmentFolder(PUBLIC_ID),
      freelancerPortfolioFolder(PUBLIC_ID),
      agencyPortfolioFolder(PUBLIC_ID),
    ]) {
      expect(folder).not.toContain(CLERK_ID);
    }
  });
});

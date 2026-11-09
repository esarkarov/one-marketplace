import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { env } from "../../config/env.js";
import { stripe } from "../../config/stripe.js";
import { db } from "../../database/client.js";
import { accounts } from "../../database/schema.js";
import { ApiError } from "../../utils/api-error.js";

export const createIdentitySession = async (
  accountId: string,
  role: "client" | "freelancer",
  context?: "agency",
) => {
  const dashboard =
    context === "agency"
      ? env.agencyDashboard
      : role === "client"
        ? env.clientDashboard
        : env.freelancerDashboard;
  if (!env.stripeSecretKey || !dashboard) {
    throw new ApiError(503, "Identity verification is not configured.");
  }

  const [account] = await db
    .select({ identityVerified: accounts.identityVerified })
    .from(accounts)
    .where(eq(accounts.auth_id, accountId))
    .limit(1);

  if (!account) throw new ApiError(404, "Account not found.");
  if (account.identityVerified) {
    throw new ApiError(409, "Identity is already verified.");
  }

  const session = await stripe.identity.verificationSessions.create({
    type: "document",
    metadata: { accountId, role },
    return_url: `${dashboard}/settings?section=${role === "client" ? "verifications" : "verification"}`,
  });

  if (!session.url) {
    throw new ApiError(502, "Identity verification could not start.");
  }
  return session.url;
};

export const completeIdentityVerification = async (
  session: Stripe.Identity.VerificationSession,
) => {
  const accountId = session.metadata.accountId;
  const role = session.metadata.role;
  if (
    session.status !== "verified" ||
    !accountId ||
    (role !== "client" && role !== "freelancer")
  ) {
    throw new ApiError(400, "Identity verification metadata is invalid.");
  }

  const [account] = await db
    .update(accounts)
    .set({ identityVerified: true, updated_at: new Date() })
    .where(
      and(
        eq(accounts.auth_id, accountId),
        eq(accounts.role, role === "client" ? "CLIENT" : "FREELANCER"),
      ),
    )
    .returning({ id: accounts.id });

  if (!account) throw new ApiError(404, "Identity account not found.");
};

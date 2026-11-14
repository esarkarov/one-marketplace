export {
  setStripeCustomerId,
  markClientOnboardingComplete,
  markFreelancerOnboardingComplete,
  markPaymentMethodVerified,
  markIdentityVerified,
  setStripeConnectAccountId,
} from "./auth.repository.js";
export {
  authenticateAccount,
  getBearerToken,
  identifyAccount,
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "./auth.middleware.js";

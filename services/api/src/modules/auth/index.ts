export {
  setStripeCustomerId,
  markClientOnboardingComplete,
  markFreelancerOnboardingComplete,
  markPaymentMethodVerified,
  markIdentityVerified,
  setStripeConnectAccountId,
} from "./repositories/auth.repository.js";
export {
  authenticateAccount,
  getBearerToken,
  identifyAccount,
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "./middleware/auth.middleware.js";

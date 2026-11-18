export {
  setStripeCustomerId,
  markClientOnboardingComplete,
  markFreelancerOnboardingComplete,
  markPaymentMethodVerified,
  markIdentityVerified,
  setStripeConnectAccountId,
  findAccountIdByAuthId,
} from "./repositories/auth.repository.js";
export {
  authenticateAccount,
  getBearerToken,
  identifyAccount,
  isAuthenticated,
  resolveAccountRole,
  verifyBearerToken,
} from "./middleware/auth.middleware.js";
export { syncAccountDisplay } from "./services/auth.display.service.js";
export type { AccountDisplay } from "./types/auth.types.js";

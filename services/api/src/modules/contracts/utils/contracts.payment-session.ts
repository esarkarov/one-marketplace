import type Stripe from "stripe";

export const CONTRACT_PAYMENT_TYPES = {
  contract: "CONTRACT_MILESTONE",
  funding: "CONTRACT_MILESTONE_FUNDING",
} as const;

export const isContractPaymentSession = (
  session: Pick<Stripe.Checkout.Session, "metadata">,
): boolean => {
  const paymentType = session.metadata?.paymentType;
  return (
    paymentType === CONTRACT_PAYMENT_TYPES.contract ||
    paymentType === CONTRACT_PAYMENT_TYPES.funding
  );
};

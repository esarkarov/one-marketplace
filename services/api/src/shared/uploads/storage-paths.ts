export const messageAttachmentFolder = (
  conversationId: string,
  senderAccountId: string,
) => `/onemarketplace/messages/${conversationId}/${senderAccountId}`;

export const jobAttachmentFolder = (clientAccountId: string) => clientAccountId;

export const freelancerPortfolioFolder = (freelancerAccountId: string) =>
  `/onemarketplace/freelancer-portfolios/${freelancerAccountId}`;

export const agencyPortfolioFolder = (agencyId: string) =>
  `/onemarketplace/agency-portfolios/${agencyId}`;

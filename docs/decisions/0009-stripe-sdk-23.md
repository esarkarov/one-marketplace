# 0009: Stripe SDK 23 and the default API version

Status: accepted (Stage 7). Supersedes Dependabot PRs #3 and #6.

## Context

`services/api` used `stripe` 22.6.2 and never sets `apiVersion`, so the SDK's built-in default applies. Major 23.0.0 moves that default from `2026-08-26.dahlia` to `2026-09-30.endive`.

## Decision

- Upgrade `stripe` to `^23.0.1`, locked at 23.0.1 (the version in the Dependabot PRs). 23.1.0 (API version `2026-10-28.endive`) is deferred to a normal minor bump after verification with real test-mode keys.
- Adopt the SDK default API version. We do not pin `apiVersion`.
- `minimumReleaseAge` is unchanged.

## Changes forced by the upgrade

- `v2.core.accountLinks.create` no longer accepts `use_case.account_onboarding.configurations` (Stripe changelog, `2026-09-30.endive`: Stripe now determines which configurations need onboarding, and requests that send the field fail). The parameter is removed in `freelancer.service.ts` and `agency.service.ts`. The recipient and merchant configurations are still requested when the account is created.
- Incomplete response bodies now throw `StripeConnectionError` instead of `StripeAPIError`. `classifyPayoutFailure` already treats both as an unknown outcome, so a payout retry still runs the `transfers.list` check first. A test now covers `StripeConnectionError` with a 200 and a 400 status.
- Webhook signature tolerance: the three `constructEvent` calls pass no tolerance and use the default. The 23.0.0 change affects `verifyHeader` called without one and `constructEvent` with tolerance `0`; neither is used here, so the replay window should stay the default (300 s). Confirm with a stale-timestamp replay in the verification stage.
- No other call shape, webhook handling or payout invariant (idempotency key `payout:<id>:<n>`, `transfer_group`, 30 s timeout, `amount_cents`) changed.

## Not verified

Nothing here touched real Stripe. The onboarding link without `configurations` and the effect of the new API version on v2 account and transfer calls must be confirmed with test-mode keys. In particular the payout destination check in `payouts.service.ts` (`v2.core.accounts.retrieve` with `include: ["configuration.recipient"]`, reading `capabilities.stripe_balance.stripe_transfers.status`) must still see an active status for an onboarded account.

## Debt

`connects.service.ts` builds a `success_url` ending in `payment=succes` (missing "s"). It is left unchanged and belongs to the frontend wiring work.

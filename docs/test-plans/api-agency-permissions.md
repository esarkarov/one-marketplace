# Test plan: Stage 8 agency role permissions

## Scope

- `services/api/src/modules/agency/agency.permissions.ts` and `requireAgencyPermission` in `agency.service.ts` (design: `docs/decisions/0010-agency-role-permissions.md`).
- Guarded paths: `POST /agency/proposals`, `POST /agency/connects/checkout`, `GET /agency/earnings/summary`, `GET /agency/earnings/overview`, `GET /agency/team/invitations`, contract accept and finish with `scope=agency`.

Use only the `_test` database with Stripe, ImageKit and Clerk mocked. Never use or print the real `.env`.

## How to run

```
pnpm --filter @onemarketplace/api test:quiet src/modules/agency/agency.permissions
```

## Cases

- Per permission, one row per role: owner with a member row, owner without one, Business manager (2xx); "Agency member", "Intern", "business manager ", a "Founder" who is not `owner_id`, and members whose role string is "owner" or "Owner" (403 `AGENCY_PERMISSION_DENIED`).
- Allowed earnings and invitations calls return the caller's own agency data only (another agency's earnings and invitations are seeded and must not appear).
- A user who owns agency A without a member row and is a plain member of agency B resolves to agency B: invitations and checkout answer 403.
- After a denied call: Connects balance and history unchanged, no proposal row, no Stripe customer or session call, contract, milestone and review rows unchanged, no notification or conversation emit.
- A caller with no agency: empty 200 on earnings and invitations, 404 on proposals and checkout, 403 "No agency account found." on accept and finish with `scope=agency`.
- An individual freelancer, and a plain "Agency member" acting on their own solo contract, accepting and finishing without `scope=agency` are unaffected (200).
- A plain member accepting and finishing an agency contract without `scope=agency` gets 404 and the contract, milestone and review rows are unchanged.
- Unit test: `isAgencyRoleAllowed` takes `{ isOwner, role }`; owner actors are allowed, non-owner actors only for an exact "Business manager", and role strings "owner", "Owner" and "Founder" are denied for every permission.

## Mutation check (Stage 8)

For each of the six permissions, the helper was changed to skip the check for that permission only. Every run failed tests: 6 for `proposal.send`, `contract.accept` and `contract.finish`, 7 for `connects.checkout` and `team.invitations.view`, 12 for `earnings.view` (two routes). Treating a "Founder" role row as owner failed 7 tests, and treating a role string "owner" as owner failed 7. The helper was restored afterwards and the 86 tests pass.

## Not covered

Real Clerk, Stripe and ImageKit. The frontends, which do not hide the denied actions yet.

# 0010: Agency role permissions

Status: accepted (Stage 8). Closes finding M8 of ADR 0008.

## Context

`agency_members.role` is free text (NOT NULL, no CHECK, no default). The code writes "Founder" for the owner's member row, "Agency member" as the invite default and "Business manager" when the owner chooses it. Before this stage any member row was enough to send proposals, spend Connects, accept and finish contracts and read earnings and invitee emails. Only team management, the payout link and profile edit were owner-only.

## Decision

One map in `services/api/src/modules/agency/agency.permissions.ts` and one helper, `requireAgencyPermission(userId, permission)` in `agency.membership.service.ts`, exposed through `agency.public.ts`. Owner resolution lives only in the helper.

| Permission              | Owner | Business manager | Any other role |
| ----------------------- | ----- | ---------------- | -------------- |
| `proposal.send`         | yes   | yes              | no             |
| `connects.checkout`     | yes   | yes              | no             |
| `contract.accept`       | yes   | yes              | no             |
| `contract.finish`       | yes   | yes              | no             |
| `earnings.view`         | yes   | yes              | no             |
| `team.invitations.view` | yes   | yes              | no             |

- **Owner**: the agency is the caller's membership, else the agency they own. The owner role applies when that agency's `owner_id` is the caller, with or without a member row. A member whose role string is "owner" or "Founder" but who is not `owner_id` is a plain member.
- **Business manager** is an exact string match. Case or whitespace variants, legacy values and unknown roles are plain members (default deny for the actions above, member rights for everything else).
- A denied call answers 403 `AGENCY_PERMISSION_DENIED`. The check runs before any side effect: a denied proposal does not deduct Connects, a denied checkout makes no Stripe call, and a denied accept or finish writes nothing.
- The check applies only when the caller acts for an agency: `POST /agency/proposals`, `POST /agency/connects/checkout`, the earnings and invitations routes, and the contract accept and finish routes with `scope=agency`. An individual freelancer on their own contract is unaffected.
- A caller with no agency keeps today's answers: empty 200 on earnings and invitations, 404 on proposals and checkout, and 403 "No agency account found." on accept and finish.
- Unchanged for every member: agency jobs, proposals list, contracts, Connects balance and history, metadata, messaging, notifications, meetings in agency conversations and milestone submission. Unchanged owner-only: team management, payout link, profile edit. The identity-verification check in contract accept is unchanged.
- No migration, no new roles.

## Client-visible changes

| Route                                                                   | Before                | After                                 |
| ----------------------------------------------------------------------- | --------------------- | ------------------------------------- |
| `POST /agency/proposals`                                                | any member            | owner or Business manager, else 403   |
| `POST /agency/connects/checkout`                                        | any member            | owner or Business manager, else 403   |
| `GET /agency/earnings/summary`, `GET /agency/earnings/overview`         | any member            | owner or Business manager, else 403   |
| `GET /agency/team/invitations`                                          | any member            | owner or Business manager, else 403   |
| Contract accept and finish (with the agency review) with `scope=agency` | any member            | owner or Business manager, else 403   |
| An owner without a member row on the six guarded routes                 | treated as non-member | resolved as the owner of their agency |

Actions plain members lose, so the frontends can hide them: send proposals, buy Connects, accept contracts, finish contracts and leave the agency review, view earnings, view the invitations list.

## Remaining open items

- The role column is still free text. A later stage could add a CHECK or enum, which needs a migration and a decision on legacy values.
- The frontends do not hide these actions yet, so members see a 403.
- Member visibility of proposal bid amounts is unchanged.
- An owner without a member row now passes these six guards but still gets 404 or empty results on the member-only reads (Connects balance and history, proposals list, contracts list, milestone submit, messaging, notifications), because `getAgencyIdForMember` does not fall back to `owner_id`. Fixing that is a separate decision.
- A new agency-acting path that skips the helper stays unguarded; the guarded list above is the one to extend.

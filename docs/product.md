# Product

Describes what the five apps show today. Every screen is a static mock: data is hardcoded, state is React `useState`, and nothing persists or calls a backend. Anything that is a business rule rather than visible UI is marked **to confirm**. Authentication (Clerk), payments (Stripe) and file storage (ImageKit) are named as planned in the README and do not exist yet.

## Roles and apps

| Role       | App                    | Entry                                                                                      |
| ---------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| Visitor    | `landing-page`         | Marketing site, talent, work and agency directories, login, signup, legal pages            |
| Client     | `client-dashboard`     | Home, Job posts, Proposals, Contracts, Messages, Settings; profile, notifications, search  |
| Freelancer | `freelancer-dashboard` | Find work, My proposals, Contracts, Saved jobs, Messages, Settings; profile, notifications |
| Agency     | `agency-dashboard`     | Find work, Proposals, Contracts, Team, Messages, Finances, Settings; profile               |
| Admin      | `admin-dashboard`      | One page: marketplace overview, action queue, account explorer                             |

- Signup offers two account types: Client and Freelancer. There is no agency or admin signup. A freelancer can "Create an agency" from freelancer settings. How agency and admin accounts are really created is **to confirm**.
- Login has no role choice. Social login buttons (Google, GitHub) are shown.

## Accounts and auth

- Signup fields: first name, last name, email, country, password (min 8), terms checkbox. Login: email, password. Forgot password: email, then a confirmation view with resend.
- Submitting any of these only shows a status text that auth will work "when Clerk is connected".
- Client identity verification is shown as processed by Stripe Identity and "required before making your first hire". Whether it is really a rule is **to confirm**.

## Job posting (client)

- Fields: title (10 to 100 characters), description (80 to 5000), expertise level (Entry level, Intermediate, Expert), expected duration (Less than 1 month, 1-2 months, 3-6 months, 6+ months), skills (comma separated), screening questions (optional), project brief attachments.
- Budget is fixed price only in the form. It is a list of milestones, each with title (min 3 characters), budget in USD (min 10) and due date (after today and after the previous milestone). The total budget is the sum. At least one milestone is required.
- Buttons: "Save draft" (no handler), "Publish job", and "Save changes" when editing. Posts are described as publicly visible in the talent marketplace.
- Job statuses: Open, Draft, Closed. A job cannot be edited once a hire exists ("Editing locked").
- Freelancer-side job data also includes hourly jobs, client rating, client spend, location, verified and featured flags. How hourly jobs are posted is **to confirm**.

## Finding work (freelancer and agency)

- Job feed tabs: Best matches, Most recent, Saved jobs. Search, and filters for experience level, duration, budget range, proposal count and verified clients only.
- Freelancers can save and unsave jobs (with an undo toast), sort saved jobs, and open a job detail page.

## Proposals

- Freelancer form: bid (USD, or per hour on hourly jobs), delivery (Less than 1 month, 1-2 months, 3-6 months, More than 6 months), cover letter (min 80 characters). It shows a Connects cost ("You'll use 8 Connects").
- Agency form: agency bid, delivery timeline, cover letter, optional milestone plan, Connects cost (16 Agency Connects shown).
- Freelancer and agency proposal statuses: Submitted, Viewed, Interview, Archived, Withdrawn. Withdrawing needs a confirmation and cannot be undone.
- Client review statuses: New, Shortlisted, Interview, Offer sent, Rejected, Hired. Whether the UI ever sets Hired, and how client and bidder statuses map to each other, is **to confirm**.
- The client picks a job, filters its proposals, opens a drawer with the cover letter and proposed milestones, and can shortlist, decline, start an interview or send a contract offer.
- Bidders show account type (Freelancer or Agency), rating, job success percentage and completed projects.

## Interviews

- There is no separate interview screen. "Start interview" moves the proposal to Interview and opens a message thread with a prefilled invitation.
- "Create meeting" posts a meeting message and opens a Google Meet new-meeting page. Calendar and scheduling features are not shown.

## Messaging

- Project threads with search, unread and online markers, replies and attachments (client, freelancer). The agency app supports text and attachments only.
- Message kinds in client and freelancer threads: text, proposal, meeting, contract, milestone, payment. These cards drive the offer, milestone and payment flows.
- Real-time delivery and notifications transport are not implemented (planned: server-sent events and Socket.IO per README).

## Contracts and milestones

- A contract offer is sent from a proposal. The freelancer sees "Awaiting your response" and can accept or decline (declining needs confirmation). Client contract statuses: Awaiting acceptance, Active, Awaiting approval, Completed. Freelancer and agency statuses: Active, Awaiting feedback (agency also Completed).
- Milestone states differ by app. Contract screens: Upcoming, In progress, Submitted, Paid. Message cards: Funded, Submitted, Changes requested, Approved.
- Client actions: fund and activate an upcoming milestone, request changes on a submitted one (with a revision note), or approve it ("Yes, approve & release"). When every milestone is Paid the contract becomes Completed. Funding one milestone at a time is what the UI shows; whether it is the rule is **to confirm**.
- Freelancer and agency submit work for a milestone with a required comment (min 10 characters), an optional deliverable link and file attachments (PDF, ZIP, PNG or JPG up to 25 MB).
- Contract cards show total budget, amount in escrow, next deadline and progress.

## Payments, earnings and finances

All business rules below are **to confirm**. The UI shows these labels and numbers only.

- Escrow: client copy says funded payments stay "protected in escrow" and are released to the freelancer after work is submitted and the client approves. Payment cards read "Protected in escrow" / "Escrow funded" then "Released" / "Payment released".
- Funding uses a saved card (for example "ending in 4821"). Clients manage cards and billing details (legal company name, billing email, country, address) in settings.
- Earnings (freelancer, agency): Pending ("pending clearance"), Available, Withdrawn. The clearance period is not stated.
- Withdrawals: choose a method (Payoneer, and a business bank for agencies), amount (freelancer minimum 50, up to available balance), a "Processing fee $1.00" line. Earnings statements can be downloaded.
- Tax information (tax residence, taxpayer ID) is collected for freelancers and agencies, described as required for compliant payouts. Clients have no tax screen.
- Platform fee or commission: no percentage appears anywhere in the UI. The admin page shows "$624K platform revenue" only.
- Refunds: none for money. A withdrawn proposal refunds Connects.
- Disputes: no dispute flow in client, freelancer or agency. The admin action queue has one sample item, a disputed $3,000 milestone release.

## Connects

- Freelancers and agencies spend Connects to send proposals (freelancer examples 6, 8, 12; agency 14 to 20). A monthly allotment (freelancer "+60") and purchases (shown at $0.15 each, default 40) appear in settings, with a history of spend, grants and refunds. Pricing, expiry and plan rules are **to confirm**.

## Profiles and reviews

- Freelancer profile: hourly rate ($5 to $1,000), availability (Available, Not available), languages with proficiency, skills, portfolio items.
- Agency profile: name, title, primary specialty, size, portfolio projects, featured members, recent reviews, stats (success rate, rating, projects).
- Client profile: name, role, location, company name, website, size and industry, with completed contracts and reviews. Reviews carry a 1 to 5 rating and text from both sides.
- Public client-side pages exist for talent (`/talent/[id]`) and agency (`/agency/[id]`).

## Agency teams

- Roles: Agency owner, Business manager, Agency member. Member status: Active, Invitation pending.
- Permissions shown: manage agency profile, submit proposals, manage contracts, view finances, manage members.
- The owner invites by name, email and role (Business manager or Agency member), and can resend or remove invitations. The exact permission each role gets is **to confirm**.

## Notifications

- Categories: Proposals, Contracts, Messages, Payments, Account (client and freelancer). Groups by Today, Yesterday, Earlier. Per-category toggles live in settings. Delivery channels (email, push) are **to confirm**.

## Admin

- A single page with metrics (total accounts, active job posts, active contracts, marketplace volume), funded, released and escrow totals, an action queue (Urgent or Medium items), an account explorer (search, type filter, status Verified, Review or Flagged) and marketplace inventory.
- The page has no real routing or actions beyond marking queue items reviewed. Admin powers (suspend, refund, resolve disputes) are **to confirm**.

## Open questions

- Fee model, escrow release rules, clearance period, dispute and refund handling, hourly contracts, Connects pricing, agency and admin account creation, identity verification requirements.

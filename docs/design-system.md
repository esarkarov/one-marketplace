# Design system

Derived from the five apps as they are today. There is no shared component library yet: `packages/ui` is an empty placeholder, and most patterns are copied class strings. Treat this as the convention to follow and converge on, not a finished system.

## Stack

- Tailwind CSS v4 through `@tailwindcss/postcss`, no Tailwind config file. Every `globals.css` starts with `@import "tailwindcss"`.
- Dashboards are utility-first with arbitrary values such as `bg-[#252724]`. Their `globals.css` is small. Only admin, agency and freelancer have an `@theme inline` block, and it maps just `--color-background`, `--color-foreground` and the fonts.
- `landing-page` also carries a 600+ line `globals.css` of custom classes (`.topbar`, `.button`, `.hero`, `.feature-card`, and similar) used by its TSX.
- No brand colors, radii or shadows are tokens yet.

## Typography

- Body font in every app: DM Sans through `next/font/google` (`--font-dm-sans`), Arial fallback.
- Dashboards use no serif. Headings are DM Sans semibold or bold with tight tracking (`tracking-[-.03em]` to `-.045em`). Small labels use `uppercase` with `tracking-[.08em]` to `[.14em]`.
- Sizes are mostly `text-xs` and `text-sm`, with arbitrary `text-[10px]`/`[11px]` for pills and meta text.
- `landing-page` headings declare "Libre Baskerville", Georgia, serif, but that font is not loaded, so Georgia renders. Geist, Fraunces and Geist Mono are loaded in some apps and unused.

## Color

Neutral-green family, shared across the dashboards. Values below are the most used; near-duplicates exist and should be merged into tokens.

| Role                   | Dashboards                                             | Landing page               |
| ---------------------- | ------------------------------------------------------ | -------------------------- |
| Page background        | `#f4f6f2`                                              | `#fbfbf9`                  |
| Text                   | `#242724` (strong text also `#252724`)                 | `#222420`                  |
| Surface                | `white`, tints `#fafbf9` `#f3f5f1`                     | `white`, `#f8f9f7`         |
| Primary dark (buttons) | `#252724`                                              | `#252724`, hover `#3c403a` |
| Accent green           | `#52784f`, link `#4e774b`, hover `#5f805b`             | `#668c63`, `#4f7a4c`       |
| Accent tint            | `#edf4ea`, `#e6f2e3`                                   | `#dcebd9`                  |
| Focus border           | `#6e916a`                                              | -                          |
| Muted text             | `#7b8078`, `#858a82`, `#a1a59e` (many near-duplicates) | `#696b66`, `#777b74`       |
| Border                 | `border-black/8` and `/10`; solid `#dfe5dc`, `#e9ede7` | `#dedfdc`, `#dcddd9`       |
| Modal scrim            | `bg-[#172018]/45 backdrop-blur-[2px]`                  | -                          |

Status colors are ad hoc, not tokens:

- Success: `#52784f` on `#edf4ea`.
- Warning: text `#82723f` or `#806d31` on `#f5f0de`.
- Danger: text `#a44c4c` or `#9a5953` on `#f8eceb`.
- Info: `#64859a` on `#e8eff4` (admin). Purple tag: `#6b5d82` on `#eeeaf5`.
- Avatar fills: `#496e67` is the most common.

## Shape, depth and layout

- Radius: inputs and buttons `rounded-xl`; cards and panels `rounded-2xl`; pills and avatars `rounded-full`. Landing buttons are fully rounded (999px); dashboard primary buttons are `rounded-xl`.
- Cards are flat with a border (`rounded-2xl border border-black/8 bg-white p-5`). Shadows are only for overlays, for example `shadow-[0_24px_70px_rgba(26,34,26,0.18)]`.
- Spacing follows the Tailwind 4px scale. Controls are `h-11` (default), `h-10` (compact) and `h-12` (large).
- Page shell: `mx-auto max-w-360 px-5 py-8 sm:px-8 lg:py-10`. Sidebar grid: `xl:grid-cols-[240px_minmax(0,1fr)]` (agency), `lg:grid-cols-[250px_minmax(0,1fr)]` (admin).
- Breakpoints are the Tailwind defaults (`sm`, `md`, `lg`, `xl`). Landing CSS adds `max-width: 760px` and `410px` media queries.

## Components

No shared components; these are the repeated patterns.

- Primary button: `h-11 cursor-pointer rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white`. Compact: `h-10 px-4 text-xs`. Variants: outlined (`border border-black/10 bg-white`), ghost (`hover:bg-black/3`), green (`hover:bg-[#5f805b]`).
- Input: `h-11 w-full rounded-xl border border-black/10 px-3 text-sm outline-none focus:border-[#6e916a]`. Textarea adds `resize-none p-3`.
- Pill or badge: `rounded-full bg-[#edf4ea] px-2.5 py-1 text-[10px] font-semibold text-[#52784f]`, with status colors swapped in.
- Modal: `role="dialog"` with `aria-modal`, `fixed inset-0 z-50`, scrim above, centered with `grid place-items-center p-5`.
- Drawer: `fixed inset-0 flex justify-end` (contract, proposal and member drawers).
- Popover or menu: `role="menu"` and `menuitem`, trigger with `aria-haspopup` and `aria-expanded`.
- Sidebar item: `rounded-xl px-3 py-3 font-medium`. Active `bg-[#edf4ea] text-[#4e774b]` with `aria-current="page"`; inactive `text-[#686d65] hover:bg-black/3`.
- Avatar: initials in a colored `rounded-full` circle. No images yet.
- Progress bar: `h-1.5 rounded-full bg-[#e6e9e3]` with a `#648b61` fill.
- Empty state: centered icon circle (`h-12 w-12 rounded-full bg-[#edf4ea] text-[#52784f]`) with text.
- Table: only in admin, a real `<table>` in an `overflow-x-auto` wrapper. Elsewhere lists are card grids.
- Toasts: `sonner`, freelancer app only. Date picker: `react-day-picker`, client app only, themed through `.rdp-root` variables.
- Icons: `@iconify/react`. Agency wraps it in a typed `Icon` (`app/_components/ui/icon.tsx`). Admin uses hand-written inline SVGs and has no iconify dependency.
- Skeletons are practically absent.

## File conventions

- Next.js App Router. `page.tsx` and `layout.tsx` are server components. Add `"use client"` only to files that need interactivity.
- Shared pieces live in `app/_components/<feature>/kebab-case.tsx`. Route-specific client views sit beside the route and are named `*-dashboard.tsx`.
- Shell pattern: `<role>-shell.tsx` composes `<role>-header.tsx` and `<role>-sidebar.tsx` around `<main>`.
- Mock data lives in `*-data.ts` or `data/` files.
- Each app has its own `AGENTS.md`. Read it before writing code, because this Next.js version differs from older releases.

## Accessibility

Present across the dashboards: landmarks (`main`, `header`, `nav`, `aside`), `aria-label` on icon buttons, `aria-hidden` on decorative SVGs, `aria-current`, `aria-expanded`, `role="dialog"` and `status`, `<html lang="en">`, and `prefers-reduced-motion` handling in the landing CSS.

Gaps to address in new work:

- Inputs use `outline-none` with a border-color change as the only focus indicator. Prefer a visible `focus-visible` ring.
- No reduced-motion handling in the dashboards, and no skip links found.
- Escape handling and focus trapping in modals and drawers were not found; check before relying on them.
- Muted grays on white (`#a1a59e`, `#858a82`) and 8 to 10px text likely fail contrast. Do not use them for essential text.
- Admin is one large file with the least ARIA coverage.

## Known inconsistencies and duplication

- The brand mark exists in four forms: identical in agency and freelancer, different in client, CSS-only in landing, absent in admin.
- Agency and freelancer duplicate their shell, header, sidebar, account dropdown, notifications popover, conversation panel, inbox list, contract card and drawer, submit-work modal, finance modal and settings navigation, with an `agency-` prefix on one side.
- Buttons, inputs, pills, cards and the modal scrim are copied class strings. These are the first candidates for `packages/ui`.
- The same colors repeat as literals, and the muted-gray and green scales have many near-duplicates.
- `freelancer-dashboard` keeps `brand-mark.tsx` and `freelancer-dashboard.tsx` at the `app/` root instead of `_components`.
- Freelancer and landing metadata still say "Generated by create next app".

## Rules for new UI

- Reuse an existing pattern above before inventing one. If the same class string appears a third time, propose moving it to `packages/ui` instead of copying it.
- Do not add new hex values when an existing one fits. Propose a token first.
- Interactive elements need a visible focus state, an accessible name and keyboard access.
- Check layouts at 320px width and at `lg`.

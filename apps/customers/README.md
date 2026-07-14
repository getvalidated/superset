# Superset Customers

Internal, team-only portal for tracking Superset customers: who's using the
product, company by company, who's paying, who's cooling off, and what we know
about them. Gated to `@superset.sh` accounts — the client redirects everyone
else, and every tRPC procedure is behind `adminProcedure` (the real gate).

A richer, visual walkthrough of the design lives in
[`docs/architecture.html`](./docs/architecture.html).

## Running it

```bash
bun dev:customers   # from the repo root — starts this app + api + web
```

Opens on `http://localhost:3005`. The `web` app is included so the sign-in
flow works locally; sign in with a `@superset.sh` Google account.

Point `POSTHOG_PROJECT_ID` at production (`264803`) in `.env` or every
activity number will be dev-project noise.

## The data model in one paragraph

Superset auto-creates a personal org for every signup, so of ~50k orgs only
~91 have more than one member — org rows are effectively user rows. The app
therefore treats **email domain** as the company: five people signing up
individually with `@acme.com` addresses never share an org, but they are one
customer. Orgs still matter for one thing: billing (subscriptions attach to
org ids). That split is the navigation:

| Page | Route | What a row is |
|---|---|---|
| **Companies** | `/companies` | An email domain — the real customer lens. Search, health/trend filters, pinned tab |
| Company detail | `/companies/$domain` | Stats, weekly chart, activity matrix, AI firmographics, per-user research, Slack tasks, users table |
| **Accounts** | `/accounts` | A DB organization — the billing lens (plan, seats, paying status) |
| Account detail | `/accounts/$orgId` | Subscription detail + members table |
| User detail | `/users/$userId` | One person's activity, health, AI-researched role/socials |

Old `/domains` URLs redirect; `/companies/<uuid>` bounces to the account page.

## Where the numbers come from

- **Activity** — one global HogQL query over 12 curated core events (never
  `$pageview`; anonymous ids pollute it), grouped by `distinct_id`, which
  equals `users.id` via `posthog.identify`. Per-company charts and the
  activity matrix run bounded follow-up queries over that company's user ids.
  **Every HogQL query must carry an explicit `LIMIT`** — PostHog silently
  clamps to 100 rows otherwise (we learned this the hard way).
- **Paying status** — `subscriptions` in Postgres, per org; a domain is
  "paying" if any of its orgs is.
- **PR merges** (activity matrix) — `github_pull_requests.mergedAt` in
  Postgres, shown on a company-level row since GitHub logins aren't mapped to
  users.
- **Health tiers** — days since last activity: active ≤7 · idle ≤14 ·
  cooling ≤30 · dormant >30. Paying + dormant = churn risk.
  (`packages/shared/src/customer-health.ts`)

## Caching (a.k.a. "why is this number an hour old?")

Layered, cheapest first: React Query on the client → 15-min in-process memos
for the big index walks → 1-hour KV cache on every PostHog query result.
Page loads are ~30–40 ms; the tradeoff is staleness up to an hour. The
sidebar's refresh button busts the server memos and client cache. Each page
shows a "data as of" note.

## AI research

Manually triggered by default — nothing spends money without a click.

- **People → Exa** (`/search` + structured output, ~2s): title, seniority,
  LinkedIn/Twitter/GitHub, location. Benchmarked more accurate and 10x
  cheaper than Claude for person lookups (~1–2¢).
- **Companies → Claude** (`claude-opus-4-8` + web search, 30s–4min): stage,
  size, HQ, funding, investors, YC batch, parent company. Benchmarked better
  than Exa here — catches acquisitions and late rounds, no wrong-entity hits
  (~10–25¢).

Results cache in KV for 30 days (1 day for empty results, since those are
often search variance). Per-domain **auto-research** toggle: researches
everyone at the domain once, in the background with a progress bar, and
covers new users as they appear; nothing re-runs unless manually triggered.
The cache is the only store for now — fields are being trialed in KV before
graduating to real `domain_enrichment` / `person_enrichment` tables.

Backend split: `packages/trpc/src/router/customers/` — `enrichment.ts`
(dual-backend research), `batch-research.ts`, `research-settings.ts`.

## Slack tasks

Company pages show a task list extracted from our Slack channels with that
customer. Matching: a `customer:<domain>` tag in the channel topic (explicit)
or name conventions like `ext-acme` (heuristic). Sync reads only new messages
since the last cursor and has Claude fold them into a running task list
(open/done, ours/theirs, permalinks). Costs nothing when there's nothing new.

Setup (one-time): create a Slack app from
[`docs/slack-app-manifest.json`](./docs/slack-app-manifest.json), install it,
and put the **User OAuth Token** (`xoxp-…`) in `.env` as
`SLACK_CUSTOMERS_TOKEN`. It reads as the installing user — no per-channel bot
invites — but Slack only exposes history for channels that user has joined.
Until the token exists, the card simply doesn't render.

Known limits: top-level messages only (thread replies need
`conversations.replies` per thread — planned), 200 new messages per sync.

## Env vars

| Var | Required | For |
|---|---|---|
| `POSTHOG_API_KEY` / `POSTHOG_PROJECT_ID` | yes | all activity data |
| `ANTHROPIC_API_KEY` | yes | company research, Slack task extraction |
| `EXA_API_KEY` | no | person research (falls back to Claude) |
| `SLACK_CUSTOMERS_TOKEN` | no | Slack task cards (hidden without it) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | no | shared caches (in-memory fallback) |
| `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WEB_URL` | yes | tRPC + auth redirects |

## Stack notes

Vite 7 SPA + TanStack Router (file-based; `routeTree.gen.ts` is generated,
never edit), React Query + tRPC 11, Tailwind v4, `@superset/ui`. The activity
matrix is hand-rolled sparse SVG — recharts has nothing for that shape. All
backend logic lives in `packages/trpc/src/router/customers/`, not here.

Deployment: static Vercel deploy of the built SPA (plan in PR #5657 —
pending domain/env confirmations). Auto-research batches are fire-and-forget
in-process; on serverless they need a QStash job (known follow-up).

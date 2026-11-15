# Tally

A private, single-user web app for my monthly money routine:

- **Expenses** — sync Splitwise, see *my share* of spending by category, review flagged items, close the month. Plus **Income** (paychecks) and **Insights** (charts) tabs.
- **Loan** — HDFC Credila education loan (INR): lender payment ledger, what my sister paid and what I owe her back, and a payoff planner.
- **Settings** — large-expense threshold, categories, history import, backup & export.

Money is stored as integer minor units (cents / paise) with an explicit currency, never floats. Accounting dates are `YYYY-MM-DD` in America/New_York. Every assumption I need to confirm is in [`DECISIONS.md`](DECISIONS.md).

## Privacy

- Only the Google account in `OWNER_EMAIL` can sign in. Every page, server action and API route re-checks the owner on the server.
- Secrets live only in environment variables (`.env.local` locally, Vercel env in production) and never reach the browser.
- `fixtures/private/` (my real Splitwise exports and confirmed per-expense decisions) and `backups/` are gitignored. Never commit them, and never paste their contents into issues, commits or docs.

## Stack

Next.js 16 (App Router) · TypeScript 7 (strict) · PostgreSQL via Drizzle ORM (`pg` driver, plain `DATABASE_URL`) · Auth.js v5 (Google) · Zod · Tailwind 4 · Recharts · Vitest.

## Local setup

Prerequisites: Node 22+ (24 recommended), pnpm 11, PostgreSQL 16 (e.g. `brew install postgresql@16 && brew services start postgresql@16`).

```bash
pnpm install
createdb tally_dev
createdb tally_test            # throwaway DB used by the test suite
cp .env.example .env.local     # then fill it in (below)
pnpm db:migrate
pnpm seed                      # one-time: categories, budgets, loan facts, payments… (safe to re-run)
pnpm dev                       # http://localhost:3000
```

### `.env.local`

| Variable | What |
|---|---|
| `DATABASE_URL` | `postgres://localhost:5432/tally_dev` locally; the Neon URL in production |
| `AUTH_SECRET` | random secret — `openssl rand -base64 33` |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google OAuth client (below) |
| `OWNER_EMAIL` | the only Google account allowed in |
| `SPLITWISE_API_KEY` | Splitwise personal API key (below) — optional until you sync |

### Google sign-in

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → **OAuth consent screen**: External, add your email as a test user (or publish it).
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://<your-domain>/api/auth/callback/google` (production)
4. Copy the client ID / secret into `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.

Only a verified Google email equal to `OWNER_EMAIL` is accepted. If `OWNER_EMAIL` is missing, nobody can sign in.

### Splitwise API key

1. Sign in at <https://secure.splitwise.com/apps> → **Register your application** (any name/URL — it's just for you).
2. On the app's page, generate the **API key** and put it in `SPLITWISE_API_KEY`.
3. In Tally, open a month → **Sync Splitwise**. The first sync stores your Splitwise user id and pins the pre-seeded "Not an expense" decisions.

Without a key you can still use **CSV import** (Expenses → Use CSV import → Import CSV, or Settings → Data).

## Monthly routine

1. Expenses → the month → **Sync Splitwise**.
2. Work through **Needs attention**: confirm categories, mark balance transfers **Not an expense**, confirm USD amounts for non-USD items.
3. Add paychecks on **Income**.
4. **Close month** — it freezes the rows, totals and budget. If Splitwise changes later, a "Changed since close" banner lets you accept or keep the snapshot.

## Commands

| Command | |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js (`pnpm start` outside Vercel needs `AUTH_TRUST_HOST=true`, or sign-in sessions are rejected) |
| `pnpm test` | full Vitest suite (engines, DB integration on `tally_test`, fixture reconciliation) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:generate` | new migration from `src/server/db/schema.ts` |
| `pnpm db:migrate` | apply `drizzle/` migrations to `DATABASE_URL` |
| `pnpm seed` | idempotent seed of real starting data (also loads `fixtures/private/confirmed-decisions.json` if present) |
| `pnpm reconcile 2026-08 [--export-date 2026-09-16] [--rows --why]` | CSV-derived month + discrepancy report vs known targets |
| `pnpm compare 2026-08` | API (owed_share) vs CSV (net balance), row by row — needs `SPLITWISE_API_KEY` |
| `pnpm backup` | write `backups/tally-backup-<date>.json.gz` |
| `pnpm restore <file> [--merge \| --replace --yes]` | restore (dry run without a flag) |
| `pnpm icons` | regenerate the app icons |

### Tests

`pnpm test` needs a reachable `tally_test` database (override with `TEST_DATABASE_URL`; the name must contain "test"). Reconciliation tests need `fixtures/private/*_export.csv`. If either is missing those tests are **skipped with a loud warning**, never silently passed.

## Deploy: Vercel + Neon

1. **Database**: create a Neon Postgres database — easiest via the Vercel dashboard → Storage / Marketplace → **Neon**, connected to this project (it adds `DATABASE_URL`). Prefer the **pooled** connection string for the app.
2. **Project**: import `krishmurjani/Tally` in Vercel (framework: Next.js; pnpm is detected from `packageManager`).
3. **Environment variables** (Production): `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `OWNER_EMAIL`, `SPLITWISE_API_KEY`. Auth.js trusts the Vercel host automatically; when self-hosting elsewhere also set `AUTH_TRUST_HOST=true`.
4. **Migrate + seed once**, from your machine, against the production database (use Neon's *direct* / unpooled URL for migrations):
   ```bash
   DATABASE_URL='<neon direct url>' OWNER_EMAIL='<you>' pnpm exec tsx scripts/migrate.ts
   DATABASE_URL='<neon direct url>' OWNER_EMAIL='<you>' pnpm exec tsx scripts/seed.ts
   ```
   Run the migrate step again whenever a deploy adds a migration in `drizzle/` (before or right after deploying). Migrations are not run during the build.
5. Add `https://<your-domain>/api/auth/callback/google` to the Google OAuth client.
6. Deploy, sign in, sync a month.

Limits worth knowing: Vercel caps request/response bodies at 4.5 MB. The web backup is gzip-compressed for that reason; for very large backups or restores use `pnpm backup` / `pnpm restore` locally against the production `DATABASE_URL`.

## Backups

- **Web**: Settings → Backup & export → *Download backup* (versioned `.json.gz` of everything) and per-area CSVs (expenses by month, category summaries, income, lender payments, reimbursements, projection schedule).
- **CLI**: `pnpm backup` writes `backups/tally-backup-<date>.json.gz` (gitignored, file mode 600).
- **Restore** always starts with a **dry run** showing, per table, rows that are new / identical / different / only-in-database. Then either:
  - **Add missing rows** — never overwrites rows that differ; refuses (and changes nothing) if the backup conflicts with separately created data.
  - **Replace everything** — deletes current data and loads the backup; requires typing `REPLACE` (or `--replace --yes` on the CLI).
- A backup can only be restored into the same account (`OWNER_EMAIL`).

## Project layout

```
src/engines/      pure calculation modules (money, dates, share rules, CSV, categories, budgets, income, loan)
src/server/       auth guard, DB schema/client, repositories, Splitwise client + sync, server actions, backup/exports
src/app/          pages: expenses/[month] (+ income, insights, import), loan (+ planner, payments, sister), settings
tests/            engines, DB integration, fixture reconciliation
scripts/          seed, migrate, reconcile, compare, backup/restore, icons
drizzle/          SQL migrations
```

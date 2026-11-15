# Build Tally — personal expense, income & education-loan tracker

You are building **Tally**, a private, single-user personal finance web app for me (Krish). Read this whole document before writing code. Start in **plan mode**: propose the schema, folder structure and phase plan, wait for my OK, then build phase by phase. **Stop at the end of each phase**, show me what works (tests + how to try it), and wait for my go-ahead.

Accuracy of money matters more than features. When data is ambiguous, surface it for me to decide — never guess a number.

---

## 0. Repo setup (do this first, before planning)

You are running inside my freshly cloned, **empty** private repo (`krishmurjani/Tally`). Do the following, showing me each command, and stop if anything looks off:

1. **Create `.gitignore` before touching any data:**
   ```
   node_modules/
   .next/
   .env
   .env*.local
   fixtures/private/
   .DS_Store
   ```
2. **Copy this prompt into the repo** as `TALLY_BUILD_PROMPT.md` (it's in `~/Downloads/` if you were pointed there).
3. **Create `fixtures/private/` and copy my Splitwise CSVs into it** from `~/Downloads/` (ask me if they aren't there). Match `*_export*.csv`. Normalize filenames to `<source>_<YYYY-MM-DD>_export.csv` by stripping any leading numeric prefix like `1794715392459_` and browser suffixes like ` (1)`. Copy, don't move — leave my originals alone. Expected files (8):
   - `18-battery-ave_2026-09-16_export.csv`
   - `18-battery-ave_2026-11-14_export.csv`
   - `group_2026-09-16_export.csv`
   - `miami_2026-09-16_export.csv`
   - `self_2026-09-16_export.csv`
   - `krish-m-and-jainam_2026-09-16_export.csv`
   - `krish-m-and-prathamesh-a_2026-09-16_export.csv`
   - `krish-m-and-siddh-m_2026-09-16_export.csv`
   If two files would normalize to the same name, stop and ask. List what you copied and what's missing.
4. **Create `CLAUDE.md`** in the repo root containing these standing rules (and follow them for the whole project):
   ```
   # Rules for this repo
   - Never add any attribution to AI, Claude, Opus, Sonnet, Fable, Anthropic or any AI tool anywhere:
     not in commit messages, commit trailers (no "Co-Authored-By", no "Generated with" lines),
     PR titles/descriptions, code comments, README/docs, package metadata or UI text.
   - Commits are authored solely by the repo owner's git identity. Never change git user.name/user.email.
   - Never add, invite or modify collaborators, teams, deploy keys or repo permissions on GitHub,
     and never change repo visibility.
   - Never commit anything in fixtures/private/, .env files or secrets.
   ```
   Also turn off Claude Code's automatic commit/PR attribution for this project in `.claude/settings.json` (check the current Claude Code docs for the exact setting name, e.g. `includeCoAuthoredBy: false` or its current equivalent) and show me the file.
5. **Verify nothing private is tracked:** run `git status` and `git check-ignore -v fixtures/private/*.csv`. Only `.gitignore`, `TALLY_BUILD_PROMPT.md`, `CLAUDE.md` and `.claude/settings.json` may be staged.
6. **First commit and push:** stage exactly those files, commit "Add build prompt, project rules and gitignore" (no trailers), `git branch -M main`, `git push -u origin main`. Show me `git log -1 --format=full` to confirm there's no attribution. If push fails on auth, stop and tell me (I'll run `gh auth login`).
7. Then begin Phase 1 (plan mode).

---

## 1. What the app is for

Once a month I want to: sync my Splitwise data, see **my personal share** of spending for that month by category, review a handful of flagged items, and close the month. I also log my paychecks, and track my Indian education loan (INR), including what my sister paid toward it and what I owe her back.

Three top-level sections: **Expenses** (with Income and Insights tabs), **Loan**, **Settings**. Must work well on phone and laptop (responsive; installable PWA manifest — no offline sync needed).

---

## 2. Stack & hosting

- Next.js (App Router) + TypeScript, strict mode.
- PostgreSQL via **Drizzle ORM** with migrations. Hosting target: **Vercel + Neon** (free tiers), connected to my GitHub. Keep it portable (plain `DATABASE_URL`).
- Auth: Auth.js with Google sign-in, **allowlisted to a single email from `OWNER_EMAIL` env var**. Everyone else is rejected. Every API route/server action checks the session server-side.
- Zod for validation. Recharts (or similar) for charts. Vitest for tests. Tailwind for styling.
- Use current stable versions; don't pin old ones.
- Secrets only in env vars, never sent to the browser. Provide `.env.example`:
  `DATABASE_URL, AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, OWNER_EMAIL, SPLITWISE_API_KEY`
- **Money is stored as integer minor units** (cents for USD, paise for INR) with an explicit currency column. No float arithmetic on persisted amounts.
- Accounting dates are date-only (`YYYY-MM-DD`). "Today" logic uses `America/New_York`.

No AI features. No vector DB. No background job infrastructure beyond what's needed.

---

## 3. Expense data source: Splitwise API (primary)

Use the official Splitwise REST API (v3.0) with my personal API key as a Bearer token, **server-side only**. Verify endpoint names/params against the official docs (dev.splitwise.com) before coding — don't rely on memory.

- `get_current_user` → my Splitwise user id (store it).
- `get_expenses` with `dated_after` / `dated_before` (and paging via `limit`/`offset`) to fetch a month. Also fetch with `updated_after` for change detection on closed months.
- Each expense has a unique `id`, `cost`, `currency_code`, `date`, `description`, `category.name`, `group_id`, `payment` (bool), `deleted_at`, `updated_at`, and `users[]` with `paid_share`, `owed_share`, `net_balance`.

### Personal share rule (the core rule)

**My personal expense = my `owed_share` on that expense.** This replaces all the old net-balance arithmetic. Specifically:

| Case | Result |
|---|---|
| `payment == true` | Excluded — "Settlement/payment" |
| `deleted_at` set | Excluded — "Deleted in Splitwise" |
| Description matches `settle all balances` (case-insensitive, normalized whitespace) | Excluded — "Settlement" |
| My `owed_share` is 0 or I'm not a participant | Excluded — "Not my expense / fully owed to me" |
| Saved "Not an expense" decision for this expense id | Excluded — with my saved reason |
| `currency_code` ≠ USD | **Needs review** — never summed into USD until I enter a confirmed USD amount |
| Otherwise | Included at `owed_share` |

- Accounting date: convert the expense `date` to a calendar date in `America/New_York`. Verify against my CSV fixtures (§5) that dates match; if any mismatch appears, show it to me rather than picking silently.
- Each Splitwise expense is stored once, keyed by `(owner, splitwise_expense_id)` — upserts are idempotent; re-syncing never duplicates.
- Keep the raw API JSON for each expense (audit) and the derived fields separately.
- Non-group expenses come back once (not per friend), so no cross-export duplicate matching is needed.

### "Not an expense" decisions (balance transfers)

Some entries are money moving between people, logged as ordinary expenses. The app needs a one-tap **"Not an expense"** action on any included row, with an optional reason, persisted by Splitwise expense id and re-applied on every sync. Undoable.

Pre-seed these confirmed decisions (match by date + description + cost on first sync, then pin to the expense id; if no unique match, show them as pending decisions):

| Date | Description | Cost (USD) | Reason |
|---|---|---:|---|
| 2026-09-01 | Varun Gas Refund (group: 18-battery-ave) | 193.28 | Roommates' money passed through me — balance adjustment |
| 2026-09-01 | Varun - Gas Refund (with Prathamesh A) | 157.98 | Same — balance adjustment |
| 2026-10-01 | Sent Sept 1 (group: 18-battery-ave) | 118.76 | Money moving between me and Yash — not spending |

Do **not** add any keyword rule (e.g. "refund", "Varun", "sent") — decisions are per expense only.

### Flags (included but highlighted)

- Large expense: my share ≥ $100 (threshold editable in Settings). Rent/phone recurring never flagged.
- "Krish borrowed"-type cash entries stay included as expenses.
- Uncategorized / newly seen Splitwise category → "Needs category" until mapped once.

### Closing a month

A month has a status: `open` → `closed`. Closing snapshots the included rows and category totals. If a later sync finds an expense in a closed month was added, edited or deleted in Splitwise, show a "Changed since close" banner with the diff and let me accept (recompute) or keep the snapshot. Never silently change a closed month.

---

## 4. Categories, mapping, recurring

App categories and default monthly budgets (USD):
Rent 875 · Gas (home utility) 40 · Electricity 100 · Groceries 100 · Transport 50 · Phone 25 · Wi-Fi 18 · Laundry 10 · Dining Out 100 · Gifts 50 · Household 0 · Personal 0 · **Total 1,368**.
Allow custom categories (e.g. "Trip - Miami", "Travel").

Splitwise category → app category (confirmed):

| Splitwise | App |
|---|---|
| Heat/gas | Gas (home utility) |
| Taxi, Bus/train, Transportation - Other | Transport |
| TV/Phone/Internet, Internet | Wi-Fi (unless the description is clearly a phone bill) |
| Phone | Phone |
| Electricity | Electricity |
| Groceries | Groceries |
| Electronics, Life - Other | Personal |
| Liquor, Dining out | Dining Out |
| Laundry, Services, Cleaning | Laundry |
| Household supplies | Household |
| Insurance, Clothing, Movies, Music, General | Personal (I'll correct individual rows) |
| Gifts | Gifts |

Suggested (not confirmed — show as suggestion, I confirm once and it's saved): Car, Gas/fuel, Parking, Bicycle → Transport (vehicle fuel is **not** home Gas); Plane, Hotel → Travel; Furniture, Home - Other → Household; Food and drink - Other → Dining Out; Utilities - Other → Personal.

**Grocery ingredient override:** items like dosa batter, roti/chapati/phulka, paneer bought from a store (e.g. "Dosa Batter (Wee)", "Roti (3), Service Fee", "Roti (5x) Wee") are Groceries even if Splitwise says Dining out. Use a small, editable keyword list matched on word boundaries; don't recategorize obvious restaurant meals. Show overridden rows with a small "auto-categorized" marker.

Every row's category is editable; manual overrides persist across syncs with an audit record and a "reset" option. Optionally "always map this Splitwise category → X".

**Recurring expenses (not in Splitwise):** Rent $875 and Phone $25, added once per month as identifiable recurring rows. Recurring rules have effective-from dates so a future rent change (I'm moving to Miami) doesn't alter past months; month-specific overrides allowed. Don't show a "rent and phone included" label on the main spending card.

**Manual expenses:** "Add expense" on every month (date within month, description, category, amount, note). Edit/delete. Signed refunds allowed deliberately.

---

## 5. CSV import (fallback + test fixtures)

Keep a CSV import path for when the API isn't usable, and because my fixtures are CSVs. Splitwise CSV format: header `Date,Description,Category,Cost,Currency,<participant columns...>`; participant columns are **net balances** in varying order (find mine by the exact name `Krish Murjani`); pairwise exports begin with a preamble line `Note: does not include group expenses`; files end with a `Total balance` footer row (not a transaction); blank lines exist; quoted fields with commas exist. Exports cover all time — filter to the selected month by Date.

CSV personal-share rules (net-balance interpretation):
- Negative my-net → share = |net|.
- Positive my-net → share = cost − net (if net == cost → 0, excluded).
- Zero → excluded.
- `Payment` category / settle-all-balances → excluded.
- Same non-group expense appears in multiple pairwise exports (e.g. "slippers" $13 with Siddh +6.50 and Jainam +6.50): **combine the owed-to-me portions once**, share = cost − sum(portions). Expected: slippers → $0, "alc + cig" $146.02 → $48.67, "our bus cancellation" $27.64 → $9.21.
- Ambiguous/mixed cases → Needs review, never guessed.

My real exports live in `fixtures/private/` (gitignored — never commit them, never paste their contents into commits, logs or docs). The 8 files are listed in §0. In the **Self** group (`self_*`, participants me + "Card"), my amount is already my share — use |my net|, no further subtraction; "Krish M. paid Card" rows are payments (excluded). Self entries prefixed "RETURN" are flagged for review (possible refunds), not auto-excluded.

---

## 6. Reconciliation targets (tests)

- **August 2026** from the 2026-09-16 exports, including $875 rent + $25 phone: **$1,821.67**. Expected categories: Rent 875.00, Gas 28.63, Electricity 70.13, Groceries 150.65, Transport 80.57, Phone 25.00, Wi-Fi 21.25, Laundry 17.13, Dining Out 225.57, Gifts 246.02, Household 8.65, Personal 73.07.
- **September 2026**: **$1,916.51** after excluding the two Varun entries ($351.26). (My Sept-16 exports only cover through Sept 15–16, so the full-month check needs a later export or the API.)
- If the engine doesn't hit a target, **do not tweak rules to force it.** Produce a discrepancy report listing the specific rows and the reasoning, and ask me. Distinguish category-allocation differences from total differences.
- Once the API sync works, add a script that compares API-derived (owed_share) totals vs CSV-derived totals for the same month and lists any row-level differences.

---

## 7. Income

Manual paycheck entries: date, take-home USD, employer, note. Add/edit/delete. I'm paid **biweekly** (some months have 3 paychecks). Monthly income = sum of entries dated in that month. Missing income shows "Not recorded", not $0.

Month overview: total spent, budget difference, income, **left over = income − expenses**, change vs previous month, items needing review.

---

## 8. Budgets & insights

- Budget editor in a drawer: currency inputs per category, live total, actual-vs-budget. Apply to this month or set as future default. "Copy last month". Changing the default never rewrites past months (month budget snapshots).
- Budget display: actual $121 vs $100 → "**$21 over · 21% over**" in red; $80 vs $100 → "$20 left"; budget 0 with spend → "$X unbudgeted"; no data → "Not recorded".
- Insights tab: spending donut by category, category actual-vs-budget bars, monthly trend (only months with data), income vs expenses by month, biggest category changes vs last month (if last month was 0, say "New", no %), large purchases. Partial/month-to-date months are labelled as such.
- Historical months: import monthly **category summaries** (no fake transactions) from my old workbooks once I provide them (build an import script/screen for a simple CSV of `month, category, amount`). Known totals for validation: May 2025 1,454.93 · Jun 1,331.79 · Jul 1,931.01 · Aug 1,481.44 · Sep 1,611.90 · Oct 1,598.66 · Nov 1,708.12 · Dec 1,407.64 · Jan 2026 1,202.36 · Feb 1,266.01 · Mar 1,406.38 · Apr 1,526.82 · May 1,388.77 · Jun 1,527.89 · Jul 1,704.81. Missing months stay "No data", never $0. If detailed data later arrives for a summary month, replace the summary — never add on top.

---

## 9. Loan (HDFC Credila, INR)

All loan math is deterministic code. Seed these facts with provenance labels.

**Loan facts**
- Sanctioned ₹75,00,000. Floating rate previously stated 11.55% (editable; support rate changes with effective dates).
- Disbursements (from lender statement): 2024-07-30 ₹45,00,000 + ₹1,04,165 + ₹20,805 (= ₹46,24,970) · 2025-01-13 ₹10,00,000 · 2025-08-19 ₹11,50,000 · 2026-01-23 ₹6,10,000. Total ₹73,84,970.
- Repayment schedule issued 2026-09-14 (label: "imported, unverified"): opening outstanding **₹88,26,923 as of 2026-09-11**; partial interest payment ₹9,846/month through Aug 2027; full EMI ₹1,29,537 from Sep 2027; final payment Sep 2038.

**Lender payment ledger** — fields: due date, paid date, amount (INR paise), payer (Krish / Sister / Other), type (PMII/EMI, Repayment, Bounce), status (paid / planned / overdue / bounced), reference, note, timestamps. Seed:

| Date | Type | Amount ₹ | Payer |
|---|---|---:|---|
| 2024-08-11 … 2025-01-11 (6 payments, 11th of each month) | PMII/EMI | 6,167 each | Sister |
| 2025-02-11 … 2025-08-11 (7 payments) | PMII/EMI | 7,500 each | Sister |
| 2025-09-11, 2025-10-11, 2025-11-11 | PMII/EMI | 9,033 each | Sister |
| 2025-12-11 | **Bounce** (audit only, excluded from totals) | 9,033 | — |
| 2025-12-16 (three entries) | PMII/EMI | 6,667 + 1,533 + 1,333 | Sister |
| 2026-01-11 | PMII/EMI | 9,033 | Sister |
| 2026-02-11 … 2026-07-11 (6 payments) | PMII/EMI | 9,846 each | Sister |
| 2026-08-11, 2026-09-11 | Repayment | 9,846 each | Sister |
| 2026-10-11, 2026-11-11 | PMII/EMI | 9,846 each | **Krish**, paid |

Sister-paid total must equal **₹2,13,935** (test this). Future: planned ₹9,846 on the 11th of each month, payer Krish, until the schedule changes to the full EMI. Planned items never count as paid until I mark them paid. Don't label these payments as "100% interest" unless an allocation is entered.

**Sister reimbursement ledger** (separate from lender payments — reimbursing her never reduces the loan):
- Sister-funded = sum of lender payments with payer Sister (₹2,13,935).
- Opening reconciliation: **₹89,502 already reimbursed**, covering Aug 2024 – Aug 2025 payments.
- Then my reimbursement entries (date, ₹ amount, note), add/edit/delete.
- Owed = max(0, funded − reimbursed) → currently **₹1,24,433** (test this). Credit = max(0, reimbursed − funded).
- Show the list of not-yet-reimbursed payments (Sep 2025 → Sep 2026).

**Payoff planner** (labelled "estimate, not lender ledger"):
- Inputs (sliders + exact number inputs): monthly take-home income, living expenses, new savings, existing savings, emergency reserve (protected), lump sum (≤ existing savings − reserve), rate, ₹/USD (default 90), transfer fee % (default 0.5), HYSA APY (default 3.4), monthly extra contribution, start date. Option to **link** income/expenses to an actual recorded month or use manual values — show which is linked; saving a month never silently changes the plan.
- Available for loan per month = max(0, income − expenses − new savings); show a deficit separately if negative.
- Monthly model: monthly rate = annual/12; interest = opening balance × monthly rate; payment capped at remaining balance; balance = max(0, opening + interest − payment). Partial-interest phase then EMI phase on calendar dates. Payments dated on/before the opening-balance date are assumed already reflected in it (never subtract twice); payments after it apply once.
- Effective INR per USD = fx × (1 − fee%).
- Optional "save first, then repay after N months": separate USD fund growing at HYSA APY ((1+APY)^(1/12) − 1), required payments continue, fund converted and applied when the delay ends; reserve untouched; leftover shown.
- Outputs: payoff date & months, total future interest, interest saved vs scheduled baseline, balance chart (plan vs baseline), month-by-month table, "required monthly contribution to finish by date X" with affordability warning. Warn on negative amortization or payments below interest. Handle zero rate, zero balance, final-payment clipping.
- Persist scenario inputs debounced (no DB write per slider tick).
- Show an assumptions panel: which inputs are verified vs estimated; note that whether Credila capitalizes unpaid interest is unverified.

---

## 10. Reliability & data

- Month sync/save in a single DB transaction. Unique constraints on Splitwise expense id, and idempotency keys on manual creates (paychecks, payments, reimbursements, expenses) so retries never duplicate.
- Optimistic concurrency (version column) on editable records; stale edit → conflict message.
- UI shows real states: saving / saved / failed (never "saved" before the server confirms). Bounded retry with backoff on transient errors.
- Splitwise rate limits: back off on 429; fetch only the needed date range.
- Export: versioned JSON backup of everything + CSVs (expenses by month, category summaries, income, lender payments, reimbursements, projection schedule). Restore with a dry-run preview; never silently overwrite.
- No sample/fake personal data in the production DB. Seeds above are real and go in a `seed` script I run once.

---

## 11. Design

Calm, warm, readable: deep forest green accents, off-white surfaces, rounded cards, generous spacing, clear type. Red only for overspending/warnings, always with text. Comfortable touch targets on mobile. Month picker always visible in Expenses. Transaction table: date, description, category, **my share**, full cost (de-emphasized), group, status/reason, edit — with search, filters (category, group, included/excluded/review) and a detail drawer explaining exactly how my share was derived from the raw data. Every chart answers a clear question, has labels/legend/tooltips and an empty state.

---

## 12. Tests (Vitest) — must pass

1. owed_share rule: payment, deleted, settle-all-balances (case/space variants), zero share, non-USD → review.
2. "Not an expense" decisions persist across re-sync; no keyword-based exclusion of other refunds.
3. Re-syncing the same data is idempotent (no duplicates, same totals).
4. Closed month + changed Splitwise expense → flagged, not silently changed.
5. CSV parser: preamble, blank lines, quoted commas, footer row, participant column found by name in any order, month boundary dates.
6. CSV pairwise combination: slippers $0, alc+cig $48.67, bus cancellation $9.21.
7. August 2026 fixture → $1,821.67 with the category breakdown above, or a clear discrepancy report.
8. Recurring rent/phone added exactly once; effective-date change doesn't touch past months.
9. Budget display cases ($21 over · 21%, $20 left, unbudgeted, not recorded).
10. Income: 2- and 3-paycheck months; missing vs zero.
11. Sister-paid total ₹2,13,935; bounce excluded; owed ₹1,24,433; reimbursement doesn't change lender totals.
12. Loan engine: zero rate, zero balance, final-payment clipping, phase change, insufficient payment warning, pre-opening payments not double-counted, planned ≠ paid, save-first fund reconciles with reserve untouched.
13. Auth: non-owner sessions can't read or write anything.

---

## 13. Phases (stop after each)

0. **Repo setup** (§0): gitignore, copy prompt + CSVs, CLAUDE.md rules (no AI attribution, no collaborators), verify, first push.
1. **Plan**: schema, structure, decisions. Wait for approval.
2. **Engines + tests**: CSV parser, share rules, category mapping, budget math, loan engine, sister ledger — pure TS modules with tests running against my fixtures. Report the August reconciliation result.
3. **App shell + auth + DB**: Next.js, Drizzle schema/migrations, Auth.js allowlist, seed script (loan facts, payments, reimbursement opening balance, budgets, recurring rules, pre-seeded decisions).
4. **Splitwise sync + Expenses screens**: sync, month view, review list, not-an-expense, category edits, manual expenses, close month, CSV import fallback.
5. **Income, budgets, insights, history import.**
6. **Loan screens**: planner, payments ledger, sister ledger.
7. **Export/restore, PWA manifest, polish, README** (local setup, Vercel + Neon deploy steps, how to get the Splitwise API key, backups). Run a production build and the full test suite; list anything unverified.

Never claim something works, is deployed or migrated unless you actually ran/verified it. Keep a short `DECISIONS.md` of every assumption you made that I should confirm.

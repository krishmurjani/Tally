# Decisions & assumptions to confirm

Each item is something I decided without an explicit instruction. Mark any you disagree with.

## Stack
1. **Auth.js v5 beta** (`next-auth@5.0.0-beta.32`, pinned exactly; confirmed by Krish). JWT sessions, no auth tables.
2. **pnpm 11**. pnpm blocks dependency build scripts by default; only `esbuild` is allowed (`pnpm-workspace.yaml`), which it needs to install its native binary.
3. **TypeScript 7.0** (latest stable). Verified in Phase 3: `next build` (Next 16.4.6) type-checks and builds with it, so no fallback was needed.
4. **Drizzle ORM 0.45 stable** (1.0 is still a release candidate).
5. Postgres driver **`pg` (node-postgres)** over a plain `DATABASE_URL`: the same code runs on local Postgres 16, Neon and Vercel, and it supports real transactions.

## Money & dates
6. Money is an integer in minor units, held as a JS number (safe to ±9×10¹⁵), plus a currency column. Decimal strings are parsed by string splitting. A value with more than 2 non-zero decimals is **rejected**, never rounded.
7. Loan interest and FX conversion use exact BigInt ratios, rounded **half away from zero, once per month, to the paisa**.
8. The HYSA growth factor `(1+APY)^(1/12) − 1` is computed as a float, because it's an irrational power. Fund balances are still rounded to whole cents each month, and the result is labelled an estimate.
9. Budget percentages ("21% over") are rounded half up to a whole percent.

## Expense rules
10. **Settle-all match is an exact phrase**: description equals "settle all balances", ignoring case and whitespace (incl. NBSP). In the fixtures these rows use category `General`, not `Payment`, so the description rule is needed on its own. A row described only as `Settled` is **not** matched; it's handled as a normal row and can be marked "Not an expense".
11. API rule order: not a participant (dropped) → payment (shown as excluded) → **owed_share 0 (dropped, see 36)** → deleted → settle-all → saved decision → non-USD → included. A negative or unreadable `owed_share` goes to **Needs review**.
12. **CSV exports of the same source**: the newest export supersedes older ones (exports cover all time), and they're never summed. Two exports of one source with the same date → stop and ask.
13. **CSV pairwise combination key**: date + normalized description + cost + Splitwise category + currency. If the same key appears twice in one export, or I'm owed by one friend and owe another on the same expense → Needs review.
14. CSV pairwise limit: if a non-group expense also involved a friend whose pairwise export I don't have, their owed-to-me portion is missing and my share would be overstated. CSV can't detect this; the API path (owed_share) doesn't have the problem.
15. **Self group**: a positive my-net (unexpected) → Needs review. Rows whose description starts with `RETURN` → Needs review (status `review`, so not summed until decided).
16. **Each month uses exactly one data source** (Splitwise API or CSV import), never both, so totals can't double-count.
17. A stored Splitwise expense that's missing from a re-fetched open month and has no `deleted_at` → marked "No longer returned by Splitwise" and sent to Needs review. Never dropped silently.
18. Pre-seeded decisions match on date + normalized description + cost and must also match the group loosely (alphanumerics only, so "18 Battery Ave" ≈ "18-battery-ave"). The non-group Varun entry matches on the friend's name "Prathamesh A". If no unique match → pending.
19. **Unmapped Splitwise categories** found in the fixtures: `Taxes`, `Medical expenses`, `Maintenance` → Needs category until mapped. Suggested mappings (Car, Parking, Plane, …) also stay in Needs category until confirmed once.
20. **Grocery keyword override** (default list: `dosa batter`, `roti`, `chapati`, `phulka`, `paneer`) applies only to rows Splitwise filed as `Dining out` or `Food and drink - Other`. It matches whole words only, so "Rotisserie" isn't matched. A restaurant dish named with one of these words (e.g. "paneer tikka") would still be moved; such rows carry an "auto-categorized" marker and can be reset.
21. "Clearly a phone bill" for TV/Phone/Internet = the description contains one of `phone bill`, `mobile`, `cell phone`, `t-mobile`, `verizon`, `at&t`, `mint mobile` (editable).
22. The large-expense flag is my share ≥ $100. Recurring rent/phone rows are never flagged.

33. **Subscriptions → Personal** (Krish, 2026-11-15). A row Splitwise filed under `TV/Phone/Internet`, `Internet` or `Utilities - Other` whose description matches a subscription keyword goes to Personal, marked auto-categorized. Default keywords (editable): `claude`, `chatgpt`, `openai`, `netflix`, `spotify`, `hulu`, `youtube premium`, `disney+`, `apple one`, `icloud`. The list is deliberately narrow: plain "apple" would catch groceries. Subscriptions filed under other categories (e.g. General, Electronics) already map to Personal.
34. A "Not an expense" decision also resolves a **Needs review** row (e.g. a returned item). It never overrides a rule exclusion such as a payment or settle-all.
35. **Confirmed decisions about specific real rows** (beyond the spec's pre-seeds) live in `fixtures/private/confirmed-decisions.json`, which is gitignored. The reconcile script and tests load it, and the Phase 3 seed script will too. They're still per-expense (date + description + cost + group), never keyword rules.

36. **Only my own expenses are tracked** (Krish, 2026-11-15). A row with **no share of mine** is dropped entirely: it's not listed (even as "excluded"), counted, flagged, matched by decisions or included in close snapshots. This replaces the spec's visible "Not my expense / fully owed to me" exclusion.
    - API: I'm not a participant, or my `owed_share` is 0, including expenses I paid for others and owe nothing on. Payments I'm part of stay visible as excluded "Settlement/payment".
    - CSV: my net is 0, or net == cost (I paid, owe nothing), or a combined pairwise share of 0 (e.g. the spec's slippers example).
    - Tracking what others owe me is out of scope for now; it can be a separate feature later.
    - CSV caveat: a net-0 row could also mean "I paid exactly my own share". A CSV can't tell; the API (`owed_share`) can, and the Phase 4 API-vs-CSV compare script will list any such rows.

## Recurring
23. Rent ($875) and Phone ($25) rules are **effective from 2026-08**, the first month reconciled in detail. Earlier months come from history summaries, which already include rent. Change this if you want detailed recurring rows in earlier months.
24. Recurring rows are computed per month from the rules (one per series per month, by construction) and frozen into the snapshot when a month closes. They're dated the 1st of the month.

## Loan
25. **Interest model**: monthly periods end on the 11th. Each period uses the rate in effect at the **start** of the period. Unpaid interest is capitalized (added to the balance). Whether Credila actually capitalizes is **unverified**.
26. Periods before the planner's start date use **recorded paid payments only**. From the start date on, the schedule's payment is used, unless a payment is already recorded for that period, in which case the recorded one is used instead (never both).
27. Planned future payments: ₹9,846 on the 11th, payer Krish, Dec 2026 → Aug 2027. The full EMI phase starts 2027-09-11.
28. **Opening reimbursement date**: the spec doesn't give one; seeded as 2025-08-31 (after the last payment it covers). The date doesn't affect any total.
29. Sister reimbursements are allocated to the **oldest** sister-funded payments first (FIFO). That's how the "not yet reimbursed" list is built.
30. **Planner affordability**: `available = income − expenses − new savings`. I assume "living expenses" does **not** include the loan payment, so the scheduled payment (converted to USD) plus the monthly extra must fit within what's available.
31. **Save-first mode**: the lump sum (≤ existing savings − reserve) goes into the HYSA fund at the start along with the monthly extras. Required loan payments continue during the delay. The whole fund is converted and applied on the last delay month; monthly extras go straight to the loan after that. The reserve is never touched.
32. Lump sum without save-first: applied on the first payment date on/after the start date.

## App, auth & database (Phase 3)
37. **Sessions**: Auth.js JWT cookie, 30-day lifetime. The `signIn` callback admits only a Google account with `email_verified === true` whose email equals `OWNER_EMAIL` (trimmed, case-insensitive). A missing `OWNER_EMAIL` rejects everyone.
38. **Two server-side checks**: every signed-in page, server action and route handler calls `requireOwner()`, which re-checks the session email against `OWNER_EMAIL` and then loads the owner row. A test scans the source to enforce this. `proxy.ts` only redirects cookie-less requests to `/signin` and is not relied on.
39. Server actions go through one wrapper (`ownerAction`): owner check → Zod validation → work. It returns a typed result (`unauthorized` / `conflict` / `invalid` / `not_found` / `server`), so the UI only shows "Saved" after the server confirms. Client retries (3 tries, 0.4 s → 1.2 s backoff) apply only to thrown or network errors, never to a conflict or validation result.
40. **Seed** (`pnpm seed`) runs in one transaction. Every insert is `ON CONFLICT DO NOTHING` on a unique key or a deterministic seed key, so re-running never duplicates **or overwrites** anything edited since. Pre-seeded decisions start `pending` and are pinned on the first sync.
41. Default budgets are seeded effective from **2025-01**. "Travel" is seeded as a custom category (no budget) because suggested mappings (Plane, Hotel) point to it.
42. Postgres CHECK constraints back up the app rules: month keys are `YYYY-MM`; a manual expense's month matches its date; manual expenses are USD; budgets and paychecks are ≥ 0; lender payments are > 0; a paid payment needs a paid date; type `bounce` ⇔ status `bounced`; a closed month needs a snapshot; at most one pinned decision per row.
43. DB integration tests use a throwaway local database (`tally_test`, or `TEST_DATABASE_URL`). They refuse to run unless the database name contains "test" and the host isn't a cloud provider. They skip loudly if the database is unreachable.
44. `next.config.ts` sets `agentRules: false`. Next 16.4's `next dev` otherwise writes an `AGENTS.md` into the repo when it detects a coding agent.

## Splitwise sync & Expenses (Phase 4)
45. **Sync window**: a month is fetched with `dated_after` = 1st − 1 day and `dated_before` = last day + 2 days (UTC). Each expense's month is then set from its New York date. Expenses from neighbouring months fetched in the margin are stored under their own month.
46. **Paging**: `limit=100`, `offset` increasing until an **empty** page, so a server-side cap on `limit` can't truncate a month. Duplicate ids across pages are dropped. There's a hard stop at 500 pages.
47. **Backoff**: on 429, wait `Retry-After` seconds (max 120) if given, otherwise 1 s, 2 s, 4 s, 8 s, 16 s. 5xx and network errors use the same backoff. 401/403 fail immediately.
48. All sync network calls happen first, then everything is written in **one transaction**: upsert, derived fields, missing detection, decision pinning, closed-month flags. A failed sync records its error and writes nothing.
49. Stored Splitwise rows keep the share-rule result **without** "Not an expense" decisions. Decisions are applied when a month is shown, so undo never needs a recompute. A confirmed USD amount re-derives the row from its stored raw JSON.
50. **Missing detection**: after a full-month sync, a stored row of that month that wasn't returned and has no `deleted_at` goes to Needs review ("No longer returned by Splitwise"). If it comes back later it's recomputed normally.
51. **Change detection** (`updated_after`) starts from the last successful sync's start time minus 5 minutes of overlap. It runs after every month sync.
52. **Closed months** are always displayed from their snapshot. Editing is disabled on a closed month. "Changed since close" compares the live data with the snapshot, using the expense's Splitwise `updated_at` as its version. "Accept" recomputes the snapshot but keeps the budget the month closed with. "Keep snapshot" dismisses that exact diff (by fingerprint), and a later, different change is flagged again.
53. **Closing is blocked** while anything is in Needs review or needs a category. Closing a month that used default budgets freezes them into that month's budget, so changing a default never rewrites it.
54. A month shows data only once it has a data source (Splitwise sync or CSV) or a manual expense. Until then it shows "Not recorded", and recurring rent/phone rows aren't added to it.
55. **CSV import** stores each file's text and works out a month's rows when the month is shown, so pairwise combination can span files. Identical files are deduped by SHA-256. A *different* file with the same source and export date is rejected ("which one is right?"). A month uses CSV only when its source is set to CSV, and sync refuses to touch a CSV month until it's switched back.
56. Non-group API expenses are labelled "Non-group (names)" from the other participants' Splitwise names. Pre-seeded decisions match the group by name (letters and digits only, case-insensitive).
57. Server-action request bodies are limited to 4 MB (CSV uploads), under Vercel's 4.5 MB cap. Each CSV file may be at most 2 MB.

### Not yet verified (needs SPLITWISE_API_KEY)
- That the API key is accepted as `Authorization: Bearer <key>`. dev.splitwise.com lists API-key auth but shows no header example.
- Whether `get_expenses` returns deleted expenses. It's not documented; both cases are handled, and an unreturned expense goes to review.
- That each expense's API `date`, converted to America/New_York, matches the CSV dates. `pnpm compare <month>` lists any `DATE` mismatches row by row.

## Open questions
Questions about specific rows in the private fixtures are raised in the phase reports, not here, so no fixture contents end up in the repo. Resolve them in the app with per-expense decisions or category overrides.

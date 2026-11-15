/**
 * Compare API-derived (owed_share) vs CSV-derived (net balance) shares for one month, row by row.
 * Read-only: calls the Splitwise API and reads fixtures/private; writes nothing.
 *
 * Usage: pnpm compare 2026-08 [--export-date 2026-09-16]
 * Needs SPLITWISE_API_KEY in .env.local. Output stays in your terminal — never commit it.
 */
import { deriveCsvMonth } from "../src/engines/csv/share";
import { addDays, assertMonthKey, monthBounds } from "../src/engines/dates";
import { formatUSD } from "../src/engines/money";
import { normalizeDescription } from "../src/engines/share";
import { hasMyShare, type LedgerRow } from "../src/engines/types";
import { createSplitwiseClient } from "../src/server/splitwise/client";
import { deriveApiRow } from "../src/server/splitwise/derive";
import { loadExports } from "./lib/load-exports";

const args = process.argv.slice(2);
const month = assertMonthKey(args[0] ?? "");
const i = args.indexOf("--export-date");
const exportDate = i >= 0 ? args[i + 1] : undefined;
const key = process.env.SPLITWISE_API_KEY;
if (!key) {
  console.error("SPLITWISE_API_KEY is not set (add it to .env.local).");
  process.exit(1);
}

const api = createSplitwiseClient({ apiKey: key });
const me = await api.getCurrentUser();
const groups = new Map((await api.getGroups()).map((g) => [g.id, g.name]));
const { start, end } = monthBounds(month);
const fetched = await api.getExpenses({ datedAfter: `${addDays(start, -1)}T00:00:00Z`, datedBefore: `${addDays(end, 2)}T00:00:00Z` });
const apiRows = fetched
  .map(({ parsed }) => ({ exp: parsed, d: deriveApiRow(parsed, { myUserId: me.id, groupNames: groups }) }))
  .filter(({ d }) => d.month === month && d.result.reason !== "no_share");
const csv = deriveCsvMonth(loadExports(exportDate ? { exportDate } : {}), month);
const csvRows = csv.rows.filter(hasMyShare);

const k = (date: string, desc: string, cost: number) => `${normalizeDescription(desc)}|${cost}`;
const csvByKey = new Map<string, LedgerRow[]>();
for (const r of csvRows) csvByKey.set(k(r.date, r.description, r.costMinor), [...(csvByKey.get(k(r.date, r.description, r.costMinor)) ?? []), r]);

const share = (r: { status: string; shareMinor: number }) => (r.status === "included" ? r.shareMinor : 0);
let apiTotal = 0;
let csvTotal = 0;
const lines: string[] = [];
const matchedCsv = new Set<LedgerRow>();
for (const { exp, d } of apiRows) {
  apiTotal += share(d.result);
  const candidates = (csvByKey.get(k(d.accountingDate, d.description, d.costMinor)) ?? []).filter((c) => !matchedCsv.has(c));
  const sameDay = candidates.find((c) => c.date === d.accountingDate);
  const near = sameDay ?? candidates.find((c) => Math.abs(Date.parse(c.date) - Date.parse(d.accountingDate)) <= 86_400_000);
  if (!near) {
    lines.push(`API only   ${d.accountingDate} ${d.description} — API ${formatUSD(share(d.result))} (${d.result.reasonText}) [raw date ${exp.date}]`);
    continue;
  }
  matchedCsv.add(near);
  if (near.date !== d.accountingDate) lines.push(`DATE       ${d.description}: API ${d.accountingDate} (raw ${exp.date}) vs CSV ${near.date}`);
  if (share(near.result) !== share(d.result) || near.result.status !== d.result.status) {
    lines.push(`SHARE      ${d.accountingDate} ${d.description}: API ${formatUSD(share(d.result))} [${d.result.reasonText}] vs CSV ${formatUSD(share(near.result))} [${near.result.reasonText}]`);
  }
}
for (const r of csvRows) {
  csvTotal += share(r.result);
  if (!matchedCsv.has(r)) lines.push(`CSV only   ${r.date} ${r.description} — CSV ${formatUSD(share(r.result))} (${r.result.reasonText})`);
}

console.log(`\n${month}: API (owed_share) ${formatUSD(apiTotal)} vs CSV (net balance) ${formatUSD(csvTotal)} — difference ${formatUSD(apiTotal - csvTotal, { signed: true })}`);
console.log("(Splitwise rows only — excludes recurring rent/phone and manual expenses.)");
for (const p of csv.partial) console.log(`⚠ ${p.fileName} ends ${p.lastDate} — CSV side is partial`);
console.log(lines.length ? `\n${lines.length} row-level difference(s):\n${lines.join("\n")}` : "\nNo row-level differences.");

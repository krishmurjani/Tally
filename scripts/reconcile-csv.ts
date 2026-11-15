/**
 * Usage: pnpm reconcile <YYYY-MM> [--export-date YYYY-MM-DD] [--rows] [--target <total>]
 * Prints the CSV-derived month: totals by category, review items, decision outcomes and,
 * when a target is known, a discrepancy report. Output stays in your terminal — never commit it.
 */
import { assertMonthKey } from "../src/engines/dates";
import { formatUSD, parseMinor } from "../src/engines/money";
import { computeCsvMonth } from "../src/engines/pipeline";
import { reconcile, type ReconcileTarget } from "../src/engines/reconcile";
import { fixturesAvailable, loadExports } from "./lib/load-exports";
import { allDecisionSpecs } from "./lib/local-decisions";
import { KNOWN_TARGETS } from "./lib/targets";

const args = process.argv.slice(2);
const month = assertMonthKey(args[0] ?? "");
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const showRows = args.includes("--rows");

if (!fixturesAvailable()) {
  console.error("fixtures/private has no *_export.csv files.");
  process.exit(1);
}

const exportDate = flag("--export-date");
const exports = loadExports(exportDate ? { exportDate } : {});
const comp = computeCsvMonth(exports, month, { decisionSpecs: allDecisionSpecs() });
const { summary, rows, csv, decisionOutcomes } = comp;
const pad = (s: string, n: number) => s.padEnd(n);
const amt = (m: number) => formatUSD(m).padStart(11);

console.log(`\n=== ${month} from ${exports.length} export(s)${exportDate ? ` dated ${exportDate}` : ""} ===`);
for (const e of csv.selection.used) console.log(`  using ${e.fileName} (${e.kind}, ${e.transactions.length} rows)`);
for (const s of csv.selection.superseded) console.log(`  superseded ${s.export.fileName} → ${s.supersededBy.fileName}`);
for (const p of csv.partial) {
  const what = p.coverage === "mtd" ? "month-to-date only" : "contains none of this month";
  console.log(`  ⚠ PARTIAL: ${p.fileName} ends ${p.lastDate} — ${what}`);
}
for (const p of csv.problems) console.log(`  ⚠ unparseable ${p.fileName}:${p.line} — ${p.message}`);

console.log("\nCategory                 Actual      Budget");
for (const c of summary.byCategory) console.log(`  ${pad(c.category, 20)} ${amt(c.actualMinor)} ${amt(c.budgetMinor)}   ${c.status.text}`);
console.log(`  ${pad("TOTAL", 20)} ${amt(summary.totalMinor)} ${amt(summary.budgetTotalMinor)}`);
console.log(`\nCounts: ${JSON.stringify(summary.counts)}`);

console.log("\nDecisions:");
for (const o of decisionOutcomes) console.log(`  ${o.specId}: ${o.state}${o.state === "pinned" ? ` → ${o.key}` : ` (${o.why})`}`);

const attention = rows.filter((r) => r.result.status === "review" || r.flags.includes("needs_category"));
if (attention.length) {
  console.log("\nNeeds attention (NOT summed into a category, or summed under 'Needs category'):");
  for (const r of attention) {
    console.log(`  ${r.date} ${pad(r.description.slice(0, 34), 34)} ${amt(r.result.shareMinor)}  [${r.sourceCategory}] ${r.result.status}: ${r.result.reasonText}${r.category.suggestion ? ` · suggestion ${r.category.suggestion}` : ""}`);
  }
}

const targetArg = flag("--target");
const target: ReconcileTarget | undefined = targetArg ? { totalMinor: parseMinor(targetArg) } : KNOWN_TARGETS[month];
if (target) {
  const rep = reconcile(summary, target);
  console.log(`\nReconciliation vs target ${formatUSD(rep.expectedTotalMinor)}: ${rep.outcome.toUpperCase()} (diff ${formatUSD(rep.totalDiffMinor, { signed: true })})`);
  for (const d of rep.categoryDiffs) {
    console.log(`  ${pad(d.category, 20)} expected ${amt(d.expectedMinor)}  actual ${amt(d.actualMinor)}  diff ${formatUSD(d.diffMinor, { signed: true })}`);
  }
}

if (showRows) {
  console.log("\nAll rows:");
  for (const r of rows) {
    console.log(`  ${r.date} ${pad(r.description.slice(0, 34), 34)} ${amt(r.result.shareMinor)} ${pad(r.result.status, 8)} ${pad(r.category.category ?? "Needs category", 18)} ${r.group ?? ""}`);
    if (args.includes("--why")) for (const s of r.result.derivation) console.log(`        · ${s}`);
  }
}

import { formatUSD } from "@/engines/money";
import type { BudgetStatus } from "@/engines/budget";

export function Usd({ minor, className = "", auto = false }: { minor: number; className?: string; auto?: boolean }) {
  return <span className={`tabular-nums ${className}`}>{formatUSD(minor, auto ? { decimals: "auto" } : {})}</span>;
}

/** Budget status text; red only for overspending, always with words. */
export function BudgetText({ status }: { status: BudgetStatus }) {
  const cls = status.tone === "danger" ? "text-danger font-medium" : status.tone === "ok" ? "text-brand" : "text-muted";
  return <span className={`text-sm ${cls}`}>{status.text}</span>;
}

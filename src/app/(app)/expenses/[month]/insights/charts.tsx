"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { monthLabel } from "@/engines/dates";
import { formatUSD } from "@/engines/money";

/** Validated categorical order (dataviz reference palette, light mode, checked on the app surface). */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const FOREST = "#2f6b4f";
const DANGER = "#b42318";
const GRID = "#e6e1d6";
const MUTED = "#5f675f";
const SURFACE = "#fffdf8";
const usd = (m: number) => formatUSD(m, { decimals: "auto" });
const axisUsd = (v: number) => (Math.abs(v) >= 100000 ? `$${Math.round(v / 100000)}k` : `$${Math.round(v / 100)}`);

function TipBox({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-md">{children}</div>;
}

export function DataTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-muted">Data table</summary>
      <table className="mt-2 w-full">
        <thead className="text-left text-xs uppercase text-faint">
          <tr>
            {columns.map((c, i) => (
              <th key={c} className={`py-1 font-medium ${i ? "text-right" : ""}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line/60">
              {r.map((c, j) => (
                <td key={j} className={`py-1 tabular-nums ${j ? "text-right" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Where did my money go? Top 7 categories + Other (never more than 8 hues). */
export function SpendingDonut({ data }: { data: { category: string; minor: number }[] }) {
  const sorted = [...data].filter((d) => d.minor > 0).sort((a, b) => b.minor - a.minor);
  const top = sorted.slice(0, 7);
  const rest = sorted.slice(7).reduce((s, d) => s + d.minor, 0);
  const slices = rest > 0 ? [...top, { category: "Other", minor: rest }] : top;
  const total = slices.reduce((s, d) => s + d.minor, 0);
  const pct = (m: number) => `${Math.round((m / total) * 100)}%`;
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[220px_1fr]">
      <div className="relative h-56">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={slices} dataKey="minor" nameKey="category" innerRadius="62%" outerRadius="95%" stroke={SURFACE} strokeWidth={2} isAnimationActive={false}>
              {slices.map((s, i) => (
                <Cell key={s.category} fill={SERIES[i]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <TipBox>
                    <b>{String(payload[0].name)}</b> · {usd(Number(payload[0].value))} ({pct(Number(payload[0].value))})
                  </TipBox>
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-xs text-muted">Total</p>
            <p className="font-semibold">{usd(total)}</p>
          </div>
        </div>
      </div>
      <ul className="space-y-1.5 text-sm" aria-label="Spending by category">
        {slices.map((s, i) => (
          <li key={s.category} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span aria-hidden className="size-3 rounded-sm" style={{ background: SERIES[i] }} />
              {s.category}
            </span>
            <span className="tabular-nums text-muted">
              <span className="text-ink">{usd(s.minor)}</span> · {pct(s.minor)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Which categories went over budget? Actual vs budget, one axis. Red only when over, with text. */
export function BudgetBars({ data }: { data: { category: string; actual: number; budget: number; status: string; over: boolean }[] }) {
  const rows = data.filter((d) => d.actual > 0 || d.budget > 0);
  return (
    <>
      <div style={{ height: Math.max(160, rows.length * 44 + 40) }}>
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis type="number" tickFormatter={axisUsd} stroke={MUTED} fontSize={12} />
            <YAxis type="category" dataKey="category" width={96} stroke={MUTED} fontSize={12} tickLine={false} />
            <Tooltip
              cursor={{ fill: "rgba(47,107,79,0.06)" }}
              content={({ active, payload }) => {
                const d = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : undefined;
                return d ? (
                  <TipBox>
                    <b>{d.category}</b>
                    <br />
                    Actual {usd(d.actual)} · Budget {usd(d.budget)}
                    <br />
                    <span className={d.over ? "text-danger" : "text-muted"}>{d.status}</span>
                  </TipBox>
                ) : null;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: MUTED }} />
            <Bar dataKey="budget" name="Budget" fill="#d8d2c4" radius={[0, 4, 4, 0]} isAnimationActive={false} />
            <Bar dataKey="actual" name="Actual (red = over budget)" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {rows.map((d) => (
                <Cell key={d.category} fill={d.over ? DANGER : FOREST} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable columns={["Category", "Actual", "Budget", "Status"]} rows={rows.map((d) => [d.category, usd(d.actual), usd(d.budget), d.status])} />
    </>
  );
}

export interface TrendPoint {
  month: string;
  total: number | null;
  income: number | null;
  partial: boolean;
  summary: boolean;
}

/** How is my spending trending? Only months with data; month-to-date months are striped and labelled. */
export function TrendBars({ points }: { points: TrendPoint[] }) {
  const data = points.filter((p) => p.total !== null).map((p) => ({ ...p, label: `${monthLabel(p.month, "short").replace(" 20", " ’")}${p.partial ? "*" : ""}` }));
  return (
    <>
      <div className="h-64">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ left: 0, right: 8 }}>
            <defs>
              <pattern id="mtd-stripes" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="#d8e8dd" />
                <line x1="0" y1="0" x2="0" y2="6" stroke={FOREST} strokeWidth="3" />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" stroke={MUTED} fontSize={12} tickLine={false} interval="preserveStartEnd" />
            <YAxis tickFormatter={axisUsd} stroke={MUTED} fontSize={12} width={48} />
            <Tooltip
              cursor={{ fill: "rgba(47,107,79,0.06)" }}
              content={({ active, payload }) => {
                const d = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                return d ? (
                  <TipBox>
                    <b>{monthLabel(d.month)}</b>: {usd(d.total!)}
                    {d.partial && <div className="text-warn">Month to date / partial</div>}
                    {d.summary && <div className="text-muted">Imported summary</div>}
                  </TipBox>
                ) : null;
              }}
            />
            <Bar dataKey="total" name="Spent" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.month} fill={d.partial ? "url(#mtd-stripes)" : FOREST} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {data.some((d) => d.partial) && <p className="text-xs text-muted">* Striped = month to date or partial data.</p>}
      <DataTable columns={["Month", "Spent", "Data"]} rows={data.map((d) => [monthLabel(d.month), usd(d.total!), d.partial ? "partial" : d.summary ? "summary" : "detailed"])} />
    </>
  );
}

/** Did I spend less than I earned? Income vs expenses per month, same axis. */
export function IncomeVsExpenses({ points }: { points: TrendPoint[] }) {
  const data = points
    .filter((p) => p.income !== null || p.total !== null)
    .map((p) => ({ ...p, label: `${monthLabel(p.month, "short").replace(" 20", " ’")}${p.partial ? "*" : ""}` }));
  return (
    <>
      <div className="h-64">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ left: 0, right: 8 }} barGap={2}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" stroke={MUTED} fontSize={12} tickLine={false} interval="preserveStartEnd" />
            <YAxis tickFormatter={axisUsd} stroke={MUTED} fontSize={12} width={48} />
            <Tooltip
              cursor={{ fill: "rgba(47,107,79,0.06)" }}
              content={({ active, payload }) => {
                const d = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                if (!d) return null;
                const left = d.income !== null && d.total !== null ? d.income - d.total : null;
                return (
                  <TipBox>
                    <b>{monthLabel(d.month)}</b>
                    <br />
                    Income {d.income === null ? "Not recorded" : usd(d.income)} · Spent {d.total === null ? "Not recorded" : usd(d.total)}
                    {left !== null && <div className={left < 0 ? "text-danger" : "text-forest-700"}>{left < 0 ? `${usd(-left)} more spent than earned` : `${usd(left)} left over`}</div>}
                  </TipBox>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: MUTED }} />
            <Bar dataKey="income" name="Income" fill={SERIES[0]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="total" name="Spent" fill={SERIES[1]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        columns={["Month", "Income", "Spent", "Left over"]}
        rows={data.map((d) => [
          monthLabel(d.month),
          d.income === null ? "Not recorded" : usd(d.income),
          d.total === null ? "Not recorded" : usd(d.total),
          d.income !== null && d.total !== null ? usd(d.income - d.total) : "—",
        ])}
      />
    </>
  );
}

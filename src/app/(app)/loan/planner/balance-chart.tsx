"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { monthLabel } from "@/engines/dates";
import type { Period } from "@/engines/loan/amortize";
import { formatINR } from "@/engines/money";

const PLAN = "#2a78d6";
const BASE = "#eb6834";
const lakhs = (paise: number) => `₹${Math.round(paise / 100 / 100000)}L`;

/** How does my plan change the balance? Plan vs the scheduled baseline, one axis (₹). */
export function BalanceChart({ plan, baseline, from }: { plan: Period[]; baseline: Period[]; from: string }) {
  const byDate = new Map<string, { date: string; plan: number | null; baseline: number | null }>();
  for (const p of baseline) if (p.date >= from) byDate.set(p.date, { date: p.date, plan: null, baseline: p.closingMinor });
  for (const p of plan) if (p.date >= from) byDate.set(p.date, { ...(byDate.get(p.date) ?? { date: p.date, baseline: null }), plan: p.closingMinor });
  const data = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const ticks = data.filter((d) => d.date.slice(5, 7) === "01").map((d) => d.date);
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--color-line)" />
          <XAxis dataKey="date" ticks={ticks} tickFormatter={(d: string) => d.slice(0, 4)} stroke="var(--color-muted)" fontSize={12} tickLine={false} />
          <YAxis tickFormatter={lakhs} stroke="var(--color-muted)" fontSize={12} width={52} />
          <Tooltip
            content={({ active, payload }) => {
              const d = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
              if (!d) return null;
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-md">
                  <b>{monthLabel(d.date.slice(0, 7))}</b>
                  <div>
                    <span style={{ color: PLAN }}>●</span> My plan: {d.plan === null ? "paid off" : formatINR(d.plan, { decimals: "never" })}
                  </div>
                  <div>
                    <span style={{ color: BASE }}>●</span> Schedule only: {d.baseline === null ? "paid off" : formatINR(d.baseline, { decimals: "never" })}
                  </div>
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--color-muted)" }} />
          <Line type="monotone" dataKey="baseline" name="Schedule only" stroke={BASE} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          <Line type="monotone" dataKey="plan" name="My plan" stroke={PLAN} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Saved payoff-planner scenario. When income/expenses are linked to a recorded month, the values
 * are copied in at link time — later edits to that month never silently change the plan; the UI
 * shows the drift and offers to update.
 */
import { z } from "zod";
import { isIsoDate, isMonthKey, type IsoDate } from "../dates";
import { isDecimalString } from "../rational";
import { PLANNER_DEFAULTS, type PlannerInputs } from "./planner";

const minor = z.number().int().min(0).max(1_000_000_000_00);
const decimal = (max: number) =>
  z
    .string()
    .trim()
    .refine((s) => isDecimalString(s) && Number(s) >= 0 && Number(s) <= max, `Enter a number between 0 and ${max}`);

export const ScenarioSchema = z.object({
  monthlyIncomeUsdMinor: minor,
  monthlyExpensesUsdMinor: minor,
  monthlyNewSavingsUsdMinor: minor,
  existingSavingsUsdMinor: minor,
  emergencyReserveUsdMinor: minor,
  lumpSumUsdMinor: minor,
  monthlyExtraUsdMinor: minor,
  annualRatePercent: decimal(100),
  fxInrPerUsd: decimal(1000),
  transferFeePercent: decimal(100),
  hysaApyPercent: decimal(100),
  startDate: z.string().refine(isIsoDate, "Expected a date"),
  saveFirstMonths: z.number().int().min(0).max(120),
  targetDate: z.string().refine(isIsoDate).nullable(),
  linked: z
    .object({
      month: z.string().refine(isMonthKey),
      incomeMinor: minor.nullable(),
      expensesMinor: minor.nullable(),
    })
    .nullable(),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

export function defaultScenario(today: IsoDate, annualRatePercent: string): Scenario {
  return {
    monthlyIncomeUsdMinor: 0,
    monthlyExpensesUsdMinor: 0,
    monthlyNewSavingsUsdMinor: 0,
    existingSavingsUsdMinor: 0,
    emergencyReserveUsdMinor: 0,
    lumpSumUsdMinor: 0,
    monthlyExtraUsdMinor: 0,
    annualRatePercent,
    fxInrPerUsd: PLANNER_DEFAULTS.fxInrPerUsd,
    transferFeePercent: PLANNER_DEFAULTS.transferFeePercent,
    hysaApyPercent: PLANNER_DEFAULTS.hysaApyPercent,
    startDate: today,
    saveFirstMonths: 0,
    targetDate: null,
    linked: null,
  };
}

/** Planner inputs: linked values (snapshotted at link time) replace the manual income/expenses. */
export function plannerInputs(s: Scenario): PlannerInputs {
  return {
    ...s,
    monthlyIncomeUsdMinor: s.linked ? (s.linked.incomeMinor ?? 0) : s.monthlyIncomeUsdMinor,
    monthlyExpensesUsdMinor: s.linked ? (s.linked.expensesMinor ?? 0) : s.monthlyExpensesUsdMinor,
  };
}

export interface LinkDrift {
  changed: boolean;
  income: { linked: number | null; now: number | null };
  expenses: { linked: number | null; now: number | null };
}

export function linkDrift(linked: NonNullable<Scenario["linked"]>, now: { incomeMinor: number | null; expensesMinor: number | null }): LinkDrift {
  return {
    changed: linked.incomeMinor !== now.incomeMinor || linked.expensesMinor !== now.expensesMinor,
    income: { linked: linked.incomeMinor, now: now.incomeMinor },
    expenses: { linked: linked.expensesMinor, now: now.expensesMinor },
  };
}

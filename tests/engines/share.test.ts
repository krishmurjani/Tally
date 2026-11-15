// Spec test 1: owed_share rule — payment, deleted, settle-all (case/space variants), zero share, non-USD → review.
import { describe, expect, it } from "vitest";
import { evaluateApiExpense, isSettleAll } from "@/engines/share";
import { apiExpense, ME } from "./helpers";

const ctx = { myUserId: ME };

describe("API personal-share rule", () => {
  it("includes my owed_share (not paid share, not net)", () => {
    const r = evaluateApiExpense(apiExpense({ myOwed: "7.25", myPaid: "20.00" }), ctx);
    expect(r).toMatchObject({ status: "included", reason: "owed_share", shareMinor: 725 });
  });

  it("excludes payments", () => {
    const r = evaluateApiExpense(apiExpense({ payment: true }), ctx);
    expect(r).toMatchObject({ status: "excluded", reason: "payment", reasonText: "Settlement/payment", shareMinor: 0 });
  });

  it("excludes deleted expenses", () => {
    const r = evaluateApiExpense(apiExpense({ deleted_at: "2026-08-20T00:00:00Z" }), ctx);
    expect(r).toMatchObject({ status: "excluded", reason: "deleted", reasonText: "Deleted in Splitwise" });
  });

  it.each(["Settle all balances", "settle all balances", "SETTLE ALL BALANCES", "  Settle   all\tbalances ", "Settle all balances"])(
    "excludes settle-all variant %j",
    (description) => {
      expect(isSettleAll(description)).toBe(true);
      expect(evaluateApiExpense(apiExpense({ description }), ctx)).toMatchObject({ status: "excluded", reason: "settle_all", reasonText: "Settlement" });
    },
  );

  it.each(["Settled", "Settle all balances later dinner", "settle balances"])("does not treat %j as settle-all", (d) => {
    expect(isSettleAll(d)).toBe(false);
  });

  it("zero owed_share (even if I paid for everyone) → not my expense, dropped", () => {
    expect(evaluateApiExpense(apiExpense({ myOwed: "0.0", myPaid: "20.00" }), ctx).reason).toBe("no_share");
    expect(evaluateApiExpense(apiExpense({ myOwed: "0.0", myPaid: "0.00" }), ctx).reason).toBe("no_share");
  });

  it("not a participant → dropped", () => {
    expect(evaluateApiExpense(apiExpense(), { myUserId: 999 }).reason).toBe("no_share");
  });

  it("payments I'm part of stay visible as excluded; others' payments are dropped", () => {
    expect(evaluateApiExpense(apiExpense({ payment: true, myOwed: "0.0", myPaid: "20.00" }), ctx).reason).toBe("payment");
    expect(evaluateApiExpense(apiExpense({ payment: true, myOwed: "20.00" }), ctx).reason).toBe("payment");
    expect(evaluateApiExpense(apiExpense({ payment: true }), { myUserId: 999 }).reason).toBe("no_share");
  });

  it("a deleted expense with no share of mine is dropped, not shown as deleted", () => {
    expect(evaluateApiExpense(apiExpense({ deleted_at: "2026-08-20T00:00:00Z", myOwed: "0.0" }), ctx).reason).toBe("no_share");
  });

  it("sends non-USD to review and never sums it", () => {
    const r = evaluateApiExpense(apiExpense({ currency_code: "INR", cost: "2000", myOwed: "1000" }), ctx);
    expect(r).toMatchObject({ status: "review", reason: "non_usd", shareMinor: 0 });
  });

  it("includes non-USD only at a confirmed USD amount", () => {
    const r = evaluateApiExpense(apiExpense({ currency_code: "INR", myOwed: "1000" }), { ...ctx, usdConfirmation: { usdMinor: 1187 } });
    expect(r).toMatchObject({ status: "included", reason: "usd_confirmed", shareMinor: 1187 });
  });

  it("applies a saved Not-an-expense decision with its reason", () => {
    const r = evaluateApiExpense(apiExpense(), { ...ctx, decision: { reason: "Balance adjustment" } });
    expect(r).toMatchObject({ status: "excluded", reason: "not_an_expense", reasonText: "Balance adjustment" });
  });

  it("checks rules in order: payment beats everything", () => {
    const r = evaluateApiExpense(apiExpense({ payment: true, deleted_at: "x", currency_code: "EUR" }), ctx);
    expect(r.reason).toBe("payment");
  });

  it("sends an unreadable or negative owed_share to review", () => {
    expect(evaluateApiExpense(apiExpense({ myOwed: "abc" }), ctx).status).toBe("review");
    expect(evaluateApiExpense(apiExpense({ myOwed: "-3.00" }), ctx)).toMatchObject({ status: "review", reason: "negative_share" });
  });

  it("explains its derivation", () => {
    const r = evaluateApiExpense(apiExpense({ myOwed: "7.25" }), ctx);
    expect(r.derivation.join("\n")).toMatch(/owed_share = 7\.25/);
  });
});

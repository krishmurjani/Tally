// Managing recurring items through the DB: instalments, raises, endings, skipped months, deletion.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { describeSeries, monthlyFixedTotal, recurringRowsForMonth } from "@/engines/recurring";
import type { ScriptDb } from "@/server/db/connect";
import * as schema from "@/server/db/schema";
import { resolveOwner, type Owner } from "@/server/owner-core";
import { UserFacingError } from "@/server/repos/errors";
import { createRecurring, deleteRecurring, loadRecurring, setRecurringEnd, setRecurringFrom, setRecurringOverride } from "@/server/repos/recurring";
import { seed } from "@/server/seed";
import { dbAvailable, ENV, openTestDb, OWNER_EMAIL, resetDb } from "./db";

const up = await dbAvailable();
const usd = (d: number) => d * 100;

describe.skipIf(!up)("recurring items (DB)", () => {
  let db: ScriptDb;
  let close: () => Promise<void>;
  let owner: Owner;
  let phoneCat: string;
  beforeAll(async () => {
    ({ db, close } = await openTestDb());
  });
  afterAll(async () => close?.());
  beforeEach(async () => {
    await resetDb(db);
    await seed(db, { ownerEmail: OWNER_EMAIL });
    owner = await resolveOwner({ user: { email: OWNER_EMAIL } }, db, ENV);
    phoneCat = (await db.select().from(schema.categories).where(eq(schema.categories.name, "Phone")))[0]!.id;
  });
  const load = () => loadRecurring(db, owner);
  const summary = async (series: string, month: string) => describeSeries((await load()).rules, (await load()).overrides, month).find((s) => s.series === series)!;
  const monthTotal = async (month: string) => {
    const { rules, overrides } = await load();
    return recurringRowsForMonth(rules, overrides, month).reduce((a, r) => a + r.costMinor, 0);
  };

  it("the seeded rent and phone are there", async () => {
    const all = describeSeries((await load()).rules, [], "2026-09");
    expect(all.map((s) => [s.name, s.amountMinor])).toEqual(expect.arrayContaining([["Rent", usd(875)], ["Phone", usd(25)]]));
  });

  it("an instalment: 12 payments, counted off month by month, gone after the last", async () => {
    const { series } = await createRecurring(db, owner, { name: "iPhone instalment", categoryId: phoneCat, amountMinor: 4166, dayOfMonth: 5, effectiveFrom: "2026-11", effectiveTo: "2027-10" });
    expect(await summary(series, "2026-10")).toMatchObject({ status: "upcoming" });
    expect(await summary(series, "2026-11")).toMatchObject({ status: "active", paymentNumber: 1, paymentsTotal: 12, paymentsLeft: 11 });
    expect(await summary(series, "2027-10")).toMatchObject({ paymentNumber: 12, paymentsLeft: 0 });
    expect(await summary(series, "2027-11")).toMatchObject({ status: "ended" });
    const base = usd(875) + usd(25);
    expect(await monthTotal("2026-11")).toBe(base + 4166);
    expect(await monthTotal("2027-11")).toBe(base);
  });

  it("a raise from a month: earlier months keep the old amount, later ones get the new one", async () => {
    const rent = (await load()).rules.find((r) => r.name === "Rent")!;
    await setRecurringFrom(db, owner, { series: rent.series, from: "2027-01", amountMinor: usd(950) });
    expect((await summary(rent.series, "2026-12")).amountMinor).toBe(usd(875));
    expect((await summary(rent.series, "2027-01")).amountMinor).toBe(usd(950));
    expect((await summary(rent.series, "2027-06")).amountMinor).toBe(usd(950));
    // changing it again from the same month edits that version rather than adding another
    await setRecurringFrom(db, owner, { series: rent.series, from: "2027-01", amountMinor: usd(960) });
    expect((await load()).rules.filter((r) => r.series === rent.series)).toHaveLength(2);
    expect((await summary(rent.series, "2027-02")).amountMinor).toBe(usd(960));
  });

  it("changing an instalment mid-way keeps its end; only the latest version carries the end month", async () => {
    const { series } = await createRecurring(db, owner, { name: "Laptop", categoryId: phoneCat, amountMinor: 5000, dayOfMonth: 1, effectiveFrom: "2026-11", effectiveTo: "2027-04" });
    await setRecurringFrom(db, owner, { series, from: "2027-02", amountMinor: 6000 });
    const versions = (await load()).rules.filter((r) => r.series === series).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    expect(versions.map((v) => [v.effectiveFrom, v.effectiveTo, v.amountMinor])).toEqual([["2026-11", null, 5000], ["2027-02", "2027-04", 6000]]);
    expect(await summary(series, "2027-04")).toMatchObject({ status: "active", amountMinor: 6000, paymentsTotal: 6 });
    expect(await summary(series, "2027-05")).toMatchObject({ status: "ended" });
    await expect(setRecurringFrom(db, owner, { series, from: "2027-06", amountMinor: 7000 })).rejects.toBeInstanceOf(UserFacingError); // after the end
  });

  it("ending an item early drops later versions; clearing the end makes it open-ended again", async () => {
    const rent = (await load()).rules.find((r) => r.name === "Rent")!;
    await setRecurringFrom(db, owner, { series: rent.series, from: "2027-06", amountMinor: usd(990) });
    await setRecurringEnd(db, owner, { series: rent.series, lastMonth: "2027-03" });
    const versions = (await load()).rules.filter((r) => r.series === rent.series);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ effectiveTo: "2027-03", amountMinor: usd(875) });
    expect((await summary(rent.series, "2027-04")).status).toBe("ended");
    await setRecurringEnd(db, owner, { series: rent.series, lastMonth: null });
    expect((await summary(rent.series, "2030-01")).status).toBe("active");
    await expect(setRecurringEnd(db, owner, { series: rent.series, lastMonth: "2026-01" })).rejects.toBeInstanceOf(UserFacingError); // before it starts
  });

  it("skip a month, charge a different amount for one month, or put it back", async () => {
    const phone = (await load()).rules.find((r) => r.name === "Phone")!;
    await setRecurringOverride(db, owner, { series: phone.series, month: "2026-10", amountMinor: null, note: "paid by employer" });
    expect(await summary(phone.series, "2026-10")).toMatchObject({ status: "skipped" });
    expect(await monthTotal("2026-10")).toBe(usd(875));
    await setRecurringOverride(db, owner, { series: phone.series, month: "2026-10", amountMinor: usd(40), note: null });
    expect(await monthTotal("2026-10")).toBe(usd(875) + usd(40));
    await setRecurringOverride(db, owner, { series: phone.series, month: "2026-10", amountMinor: null, note: null, clear: true });
    expect(await monthTotal("2026-10")).toBe(usd(875) + usd(25));
    expect(monthlyFixedTotal(describeSeries((await load()).rules, (await load()).overrides, "2026-10"))).toBe(usd(900));
  });

  it("deleting removes the item and its overrides, nothing else", async () => {
    const phone = (await load()).rules.find((r) => r.name === "Phone")!;
    await setRecurringOverride(db, owner, { series: phone.series, month: "2026-10", amountMinor: null, note: null });
    await deleteRecurring(db, owner, phone.series);
    const left = await load();
    expect(left.rules.map((r) => r.name)).toEqual(["Rent"]);
    expect(left.overrides).toHaveLength(0);
    await expect(deleteRecurring(db, owner, phone.series)).rejects.toThrow();
  });

  it("refuses nonsense: zero amounts, an end before the start, someone else's category", async () => {
    const ok = { name: "X", categoryId: phoneCat, amountMinor: 100, dayOfMonth: 1, effectiveFrom: "2026-11", effectiveTo: null };
    await expect(createRecurring(db, owner, { ...ok, amountMinor: 0 })).rejects.toBeInstanceOf(UserFacingError);
    await expect(createRecurring(db, owner, { ...ok, effectiveTo: "2026-10" })).rejects.toBeInstanceOf(UserFacingError);
    await expect(createRecurring(db, owner, { ...ok, categoryId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow();
  });
});

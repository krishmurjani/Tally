import { describe, expect, it } from "vitest";
import { formatINR, formatUSD, minorToDecimalString, parseMinor } from "@/engines/money";
import { addMonths, biweekly, dateInMonth, monthBounds, nyDate, todayNY } from "./helpers";

describe("parseMinor", () => {
  it.each([
    ["25.0", 2500],
    ["25", 2500],
    ["-4.49", -449],
    ["0.00", 0],
    ["1,234.56", 123456],
    ["₹9,846", 984600],
    [" 13.000 ", 1300],
    ["+0.5", 50],
  ])("%s → %d", (s, v) => expect(parseMinor(s)).toBe(v));

  it.each(["", " ", "abc", "1.234", "1.2.3", "--1"])("rejects %j", (s) => {
    expect(() => parseMinor(s)).toThrow();
  });

  it("is exact where floats are not (0.1 + 0.2)", () => {
    expect(parseMinor("0.10") + parseMinor("0.20")).toBe(parseMinor("0.30"));
  });
});

describe("formatting", () => {
  it("formats USD", () => {
    expect(formatUSD(182167)).toBe("$1,821.67");
    expect(formatUSD(-449)).toBe("−$4.49");
    expect(formatUSD(2100, { decimals: "auto" })).toBe("$21");
  });
  it("formats INR with Indian grouping", () => {
    expect(formatINR(12443300)).toBe("₹1,24,433");
    expect(formatINR(882692300)).toBe("₹88,26,923");
    expect(formatINR(750000000)).toBe("₹75,00,000");
    expect(formatINR(98400)).toBe("₹984");
    expect(formatINR(98450)).toBe("₹984.50");
  });
  it("round-trips decimal strings", () => {
    expect(minorToDecimalString(-5)).toBe("-0.05");
    expect(minorToDecimalString(182167)).toBe("1821.67");
  });
});

describe("dates", () => {
  it("converts instants to New York calendar dates (incl. DST and late-evening UTC)", () => {
    expect(nyDate("2026-08-15T12:00:00Z")).toBe("2026-08-15");
    expect(nyDate("2026-09-01T03:30:00Z")).toBe("2026-08-31"); // 23:30 EDT
    expect(nyDate("2026-12-01T04:59:59Z")).toBe("2026-11-30"); // 23:59 EST
    expect(nyDate("2026-12-01T05:00:00Z")).toBe("2026-12-01");
  });
  it("today uses New York, not UTC", () => {
    expect(todayNY(new Date("2026-11-15T02:00:00Z"))).toBe("2026-11-14");
  });
  it("month helpers", () => {
    expect(monthBounds("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthBounds("2028-02").end).toBe("2028-02-29");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(dateInMonth("2026-02", 31)).toBe("2026-02-28");
  });
  it("UNYT paydays: 11/6, 11/20, 12/4 and so on", () => {
    expect(biweekly("2026-11-06", "2026-11")).toEqual(["2026-11-06", "2026-11-20"]);
    expect(biweekly("2026-11-06", "2026-12")).toEqual(["2026-12-04", "2026-12-18"]);
    expect(biweekly("2026-11-06", "2027-01")).toEqual(["2027-01-01", "2027-01-15", "2027-01-29"]);
  });

  it("biweekly paydays: some months have 3", () => {
    expect(biweekly("2026-01-02", "2026-01")).toEqual(["2026-01-02", "2026-01-16", "2026-01-30"]);
    expect(biweekly("2026-01-02", "2026-02")).toEqual(["2026-02-13", "2026-02-27"]);
  });
});

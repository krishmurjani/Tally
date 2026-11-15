// Spec test 5 (parser) and test 6 (pairwise combination) on synthetic CSVs — no private data.
import { describe, expect, it } from "vitest";
import { normalizeExportFileName, parseExportFileName, parseSplitwiseExport, tokenizeCsv } from "@/engines/csv/parse";
import { deriveCsvMonth, selectLatestExports } from "@/engines/csv/share";

const groupCsv = [
  "Date,Description,Category,Cost,Currency,Alice,Krish Murjani,Bob",
  "",
  '2026-08-01,"Groceries, snacks",Groceries,30.00,USD,-10.00,20.00,-10.00',
  "2026-08-02,Dinner,Dining out,30.00,USD,20.00,-10.00,-10.00",
  "2026-08-03,Alice paid Krish M.,Payment,5.00,USD,5.00,-5.00,0.00",
  "2026-08-04,Settle all balances,General,40.00,USD,-40.00,40.00,0.00",
  "2026-08-05,Bob's thing,General,12.00,USD,6.00,0.00,-6.00",
  "2026-08-06,Fully owed to me,General,12.00,USD,-12.00,12.00,0.00",
  "2026-07-31,July row,Groceries,9.00,USD,-3.00,6.00,-3.00",
  "2026-09-01,Sept row,Groceries,9.00,USD,-3.00,6.00,-3.00",
  '2026-08-31,"Quote ""inside"" field",General,3.00,USD,0.00,-3.00,3.00',
  "",
  "2026-09-16,Total balance, , ,USD,-1.00,2.00,-1.00",
  "",
].join("\n");

const pair = (friend: string, rows: string[], first = true) =>
  [
    "Note: does not include group expenses",
    "",
    first ? `Date,Description,Category,Cost,Currency,Krish Murjani,${friend}` : `Date,Description,Category,Cost,Currency,${friend},Krish Murjani`,
    ...rows,
    "",
    `2026-09-16,Total balance, , ,USD,0.00,0.00`,
  ].join("\r\n");

describe("CSV tokenizer", () => {
  it("handles quotes, escaped quotes, commas, CRLF and embedded newlines", () => {
    expect(tokenizeCsv('a,"b,c","d ""e""",\r\n"x\ny",z')).toEqual([
      ["a", "b,c", 'd "e"', ""],
      ["x\ny", "z"],
    ]);
  });
  it("throws on an unterminated quote", () => {
    expect(() => tokenizeCsv('a,"b')).toThrow();
  });
});

describe("Splitwise export parser", () => {
  const e = parseSplitwiseExport("18-battery-ave_2026-09-16_export.csv", groupCsv);

  it("finds my column by exact name regardless of order", () => {
    expect(e.participants).toEqual(["Alice", "Krish Murjani", "Bob"]);
    expect(e.transactions[0]!.myNetMinor).toBe(2000);
  });
  it("skips blank lines and the Total balance footer", () => {
    expect(e.transactions).toHaveLength(9);
    expect(e.footer?.date).toBe("2026-09-16");
    expect(e.transactions.some((t) => t.description === "Total balance")).toBe(false);
  });
  it("keeps quoted commas and escaped quotes", () => {
    expect(e.transactions[0]!.description).toBe("Groceries, snacks");
    expect(e.transactions.at(-1)!.description).toBe('Quote "inside" field');
  });
  it("detects export kind and source from the filename", () => {
    expect(e.kind).toBe("group");
    expect(e.source).toBe("18-battery-ave");
    expect(e.exportDate).toBe("2026-09-16");
    const p = parseSplitwiseExport("krish-m-and-x_2026-09-16_export.csv", pair("X", []));
    expect(p.kind).toBe("pairwise");
    const s = parseSplitwiseExport("self_2026-09-16_export.csv", "Date,Description,Category,Cost,Currency,Krish Murjani,Card\n");
    expect(s.kind).toBe("self");
  });
  it("handles the preamble with my column second", () => {
    const p = parseSplitwiseExport("krish-m-and-x_2026-09-16_export.csv", pair("X", ["2026-08-10,Taxi,Taxi,10.00,USD,5.00,-5.00"], false));
    expect(p.transactions[0]!.myNetMinor).toBe(-500);
  });
  it("rejects a file without my exact name", () => {
    expect(() => parseSplitwiseExport("x_2026-09-16_export.csv", "Date,Description,Category,Cost,Currency,Krish M\n")).toThrow(/Krish Murjani/);
  });
  it("reports unparseable rows instead of dropping them", () => {
    const bad = parseSplitwiseExport("g_2026-09-16_export.csv", "Date,Description,Category,Cost,Currency,Krish Murjani,A\n2026-08-01,x,General,abc,USD,1.00,-1.00\n");
    expect(bad.transactions).toHaveLength(0);
    expect(bad.problems).toHaveLength(1);
  });
  it("normalizes downloaded filenames", () => {
    expect(normalizeExportFileName("1794715392459_self_2026-09-16_export (1).csv")).toBe("self_2026-09-16_export.csv");
    expect(parseExportFileName("1794715392459_miami_2026-09-16_export.csv")).toEqual({ source: "miami", exportDate: "2026-09-16" });
  });
});

describe("CSV share rules (group export)", () => {
  const month = deriveCsvMonth([parseSplitwiseExport("g_2026-09-16_export.csv", groupCsv)], "2026-08");
  const by = (d: string) => month.rows.find((r) => r.description === d)!.result;

  it("filters to the month by Date (boundary days in, neighbours out)", () => {
    expect(month.rows.map((r) => r.date)).not.toContain("2026-07-31");
    expect(month.rows.map((r) => r.date)).not.toContain("2026-09-01");
    expect(month.rows.map((r) => r.date)).toContain("2026-08-31");
  });
  it("positive net → cost − net", () => expect(by("Groceries, snacks")).toMatchObject({ status: "included", shareMinor: 1000 }));
  it("negative net → |net|", () => expect(by("Dinner")).toMatchObject({ status: "included", shareMinor: 1000 }));
  it("payment excluded", () => expect(by("Alice paid Krish M.").reason).toBe("payment"));
  it("settle-all excluded even when category is General", () => expect(by("Settle all balances").reason).toBe("settle_all"));
  it("rows with no share of mine are dropped entirely: net 0, and net == cost (I paid, owe nothing)", () => {
    expect(month.rows.find((r) => r.description === "Bob's thing")).toBeUndefined();
    expect(month.rows.find((r) => r.description === "Fully owed to me")).toBeUndefined();
    expect(month.noShareCount).toBe(2);
  });
});

describe("Pairwise combination (spec test 6)", () => {
  // Synthetic copies of the three spec examples.
  const siddh = parseSplitwiseExport(
    "krish-m-and-siddh-m_2026-09-16_export.csv",
    pair("Siddh Mandirwala", [
      "2026-08-12,slippers,Clothing,13.00,USD,6.50,-6.50",
      "2026-08-14,alc + cig,Liquor,146.02,USD,48.68,-48.68",
      "2026-08-20,our bus cancellation,Bus/train,27.64,USD,9.21,-9.21",
    ]),
  );
  const jainam = parseSplitwiseExport(
    "krish-m-and-jainam_2026-09-16_export.csv",
    pair("Jainam", ["2026-08-12,slippers,Clothing,13.00,USD,6.50,-6.50", "2026-08-14,alc + cig,Liquor,146.02,USD,48.67,-48.67"]),
  );
  const pratham = parseSplitwiseExport(
    "krish-m-and-prathamesh-a_2026-09-16_export.csv",
    pair("Prathamesh A", ["2026-08-20,our bus cancellation,Bus/train,27.64,USD,-9.22,9.22"], false),
  );
  const rows = deriveCsvMonth([siddh, jainam, pratham], "2026-08").rows;
  const share = (d: string) => rows.find((r) => r.description === d)!.result;

  it("slippers $13 with Siddh +6.50 and Jainam +6.50 → $0, so it's not my expense and is dropped", () => {
    expect(rows.find((r) => r.description === "slippers")).toBeUndefined();
  });
  it("alc + cig $146.02 → $48.67", () => {
    expect(share("alc + cig")).toMatchObject({ status: "included", shareMinor: 4867, reason: "csv_pairwise_combined" });
  });
  it("our bus cancellation $27.64 → $9.21", () => {
    expect(share("our bus cancellation")).toMatchObject({ status: "included", shareMinor: 921 });
  });
  it("each combined expense appears once", () => {
    expect(rows.filter((r) => r.description === "alc + cig")).toHaveLength(1);
  });
  it("mixed owe/owed across friends → review, never guessed", () => {
    const a = parseSplitwiseExport("krish-m-and-a_2026-09-16_export.csv", pair("A", ["2026-08-01,odd,General,10.00,USD,5.00,-5.00"]));
    const b = parseSplitwiseExport("krish-m-and-b_2026-09-16_export.csv", pair("B", ["2026-08-01,odd,General,10.00,USD,-2.00,2.00"]));
    expect(deriveCsvMonth([a, b], "2026-08").rows[0]!.result).toMatchObject({ status: "review", reason: "ambiguous_csv" });
  });
  it("identical rows twice in one export → review", () => {
    const a = parseSplitwiseExport(
      "krish-m-and-a_2026-09-16_export.csv",
      pair("A", ["2026-08-01,coffee,Dining out,6.00,USD,3.00,-3.00", "2026-08-01,coffee,Dining out,6.00,USD,3.00,-3.00"]),
    );
    expect(deriveCsvMonth([a], "2026-08").rows[0]!.result.status).toBe("review");
  });
});

describe("Self group", () => {
  const self = parseSplitwiseExport(
    "self_2026-09-16_export.csv",
    [
      "Date,Description,Category,Cost,Currency,Krish Murjani,Card",
      "2026-08-03,coffee,Dining out,4.25,USD,-4.25,4.25",
      "2026-08-04,Krish M. paid Card,Payment,50.00,USD,50.00,-50.00",
      "2026-08-05,RETURN - thing,General,12.34,USD,-12.34,12.34",
      "2026-09-16,Total balance, , ,USD,-4.25,4.25",
    ].join("\n"),
  );
  const rows = deriveCsvMonth([self], "2026-08").rows;
  it("uses |my net| with no further subtraction", () => expect(rows[0]!.result).toMatchObject({ status: "included", shareMinor: 425, reason: "csv_self" }));
  it("'Krish M. paid Card' is a payment", () => expect(rows[1]!.result.reason).toBe("payment"));
  it("RETURN rows are flagged for review, not excluded", () => expect(rows[2]!.result).toMatchObject({ status: "review", reason: "possible_refund" }));
});

describe("Export selection", () => {
  const mk = (d: string) => parseSplitwiseExport(`house_${d}_export.csv`, "Date,Description,Category,Cost,Currency,Krish Murjani,A\n");
  it("newest export of a source supersedes older ones (never summed)", () => {
    const s = selectLatestExports([mk("2026-09-16"), mk("2026-11-14")]);
    expect(s.used.map((e) => e.exportDate)).toEqual(["2026-11-14"]);
    expect(s.superseded).toHaveLength(1);
  });
  it("two exports with the same date → stop and ask", () => {
    expect(() => selectLatestExports([mk("2026-09-16"), mk("2026-09-16")])).toThrow();
  });
});

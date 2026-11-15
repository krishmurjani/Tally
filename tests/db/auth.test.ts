// Spec test 13: non-owner sessions can't read or write anything.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { ScriptDb } from "@/server/db/connect";
import { isOwnerEmail, resolveOwner, UnauthorizedError, type Owner } from "@/server/owner-core";
import { dataStatus } from "@/server/repos/overview";
import { ConflictError } from "@/server/repos/errors";
import { getSettings, updateLargeThreshold } from "@/server/repos/settings";
import { seed } from "@/server/seed";
import { allowSignIn } from "@/server/signin-policy";
import { dbAvailable, ENV, openTestDb, OWNER_EMAIL, resetDb } from "./db";

describe("sign-in policy (Auth.js signIn callback)", () => {
  const google = { provider: "google" };
  it("allows only the verified owner email", () => {
    expect(allowSignIn(google, { email: OWNER_EMAIL, email_verified: true }, ENV)).toBe(true);
    expect(allowSignIn(google, { email: "  OWNER@Example.TEST ", email_verified: true }, ENV)).toBe(true);
  });
  it.each([
    ["another account", google, { email: "someone@example.test", email_verified: true }],
    ["unverified email", google, { email: OWNER_EMAIL, email_verified: false }],
    ["missing verification flag", google, { email: OWNER_EMAIL }],
    ["no email", google, { email_verified: true }],
    ["another provider", { provider: "github" }, { email: OWNER_EMAIL, email_verified: true }],
    ["lookalike email", google, { email: `${OWNER_EMAIL}.evil.com`, email_verified: true }],
  ])("rejects %s", (_, account, profile) => {
    expect(allowSignIn(account, profile, ENV)).toBe(false);
  });
  it("fails closed when OWNER_EMAIL is unset", () => {
    expect(allowSignIn(google, { email: OWNER_EMAIL, email_verified: true }, {})).toBe(false);
    expect(isOwnerEmail(OWNER_EMAIL, { OWNER_EMAIL: "  " })).toBe(false);
  });
});

describe("every entry point checks the owner server-side", () => {
  const root = join(import.meta.dirname, "../../src");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const files = walk(root);

  it("each exported server action goes through ownerAction/requireOwner", () => {
    const actionFiles = files.filter((f) => readFileSync(f, "utf8").trimStart().startsWith('"use server"'));
    expect(actionFiles.length).toBeGreaterThan(0);
    for (const f of actionFiles) {
      const src = readFileSync(f, "utf8");
      const fns = [...src.matchAll(/export async function (\w+)\s*\([^)]*\)\s*(?::[^{]+)?\{([\s\S]*?)\n\}/g)];
      expect(fns.length, relative(root, f)).toBeGreaterThan(0);
      for (const [, name, body] of fns) {
        expect(/ownerAction\(|requireOwner\(/.test(body!), `${relative(root, f)}: ${name} must call ownerAction/requireOwner`).toBe(true);
      }
    }
  });

  it("each route handler (other than Auth.js's own) calls requireOwner", () => {
    const routes = files.filter((f) => /route\.ts$/.test(f) && !f.includes(`${join("api", "auth")}`));
    for (const f of routes) expect(readFileSync(f, "utf8"), relative(root, f)).toMatch(/requireOwner\(/);
  });

  it("each signed-in page calls requireOwner*", () => {
    const pages = files.filter((f) => f.includes(`${join("app", "(app)")}`) && /page\.tsx$/.test(f));
    expect(pages.length).toBeGreaterThan(0);
    for (const f of pages) expect(readFileSync(f, "utf8"), relative(root, f)).toMatch(/requireOwner(OrRedirect)?\(/);
  });
});

const up = await dbAvailable();

describe.skipIf(!up)("owner resolution and data isolation (DB)", () => {
  let db: ScriptDb;
  let close: () => Promise<void>;
  let owner: Owner;
  let otherId: string;

  beforeAll(async () => {
    ({ db, close } = await openTestDb());
    await resetDb(db);
    await seed(db, { ownerEmail: OWNER_EMAIL });
    owner = await resolveOwner({ user: { email: OWNER_EMAIL } }, db, ENV);
    // A second owner row, to prove queries are scoped (the app itself only ever has one).
    const [o] = await db
      .insert(schema.owners)
      .values({ email: "intruder@example.test", settings: { largeExpenseThresholdMinor: 1 } })
      .returning();
    otherId = o!.id;
  });
  afterAll(async () => close?.());

  it("no session / non-owner session / missing OWNER_EMAIL → Unauthorized", async () => {
    await expect(resolveOwner(null, db, ENV)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(resolveOwner({ user: null }, db, ENV)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(resolveOwner({ user: { email: "intruder@example.test" } }, db, ENV)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(resolveOwner({ user: { email: OWNER_EMAIL } }, db, {})).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("a non-owner email can't be resolved even if it has an owners row", async () => {
    await expect(resolveOwner({ user: { email: "intruder@example.test" } }, db, ENV)).rejects.toThrow(/not allowed/);
  });

  it("the owner resolves case-insensitively", async () => {
    const o = await resolveOwner({ user: { email: "Owner@Example.Test" } }, db, ENV);
    expect(o.id).toBe(owner.id);
  });

  it("reads are scoped to the owner", async () => {
    const mine = await dataStatus(db, owner);
    const theirs = await dataStatus(db, { id: otherId, email: "intruder@example.test" });
    expect(mine.lenderPayments).toBeGreaterThan(0);
    expect(Object.values(theirs).every((n) => n === 0)).toBe(true);
  });

  it("writes are scoped to the owner and versioned (stale edit → conflict)", async () => {
    const s = await getSettings(db, owner);
    const saved = await updateLargeThreshold(db, owner, { thresholdMinor: 15000, expectedVersion: s.version });
    expect(saved).toMatchObject({ largeExpenseThresholdMinor: 15000, version: s.version + 1 });
    await expect(updateLargeThreshold(db, owner, { thresholdMinor: 1, expectedVersion: s.version })).rejects.toBeInstanceOf(ConflictError);
    const [other] = await db.select().from(schema.owners).where(eq(schema.owners.id, otherId));
    expect(other!.settings.largeExpenseThresholdMinor).toBe(1);
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.ownerId, owner.id));
    expect(audit).toHaveLength(1);
  });
});

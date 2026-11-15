"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { decodeBackup, previewRestore, restoreBackup } from "../backup";
import { UserFacingError } from "../repos/errors";
import { ownerAction } from "./run";

const MAX = 4 * 1024 * 1024;

async function readFile(fd: FormData) {
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) throw new UserFacingError("Choose a backup file.");
  if (f.size > MAX) throw new UserFacingError("That backup is larger than 4 MB — restore it with `pnpm restore` from your computer instead.");
  return decodeBackup(new Uint8Array(await f.arrayBuffer()));
}

/** Dry run — reads the file and compares; writes nothing. */
export async function previewRestoreAction(fd: FormData) {
  return ownerAction(z.instanceof(FormData), fd, async ({ db, owner, input }) => previewRestore(db, owner, await readFile(input)));
}

export async function restoreBackupAction(fd: FormData) {
  const res = await ownerAction(z.instanceof(FormData), fd, async ({ db, owner, input }) => {
    const mode = z.enum(["merge", "replace"]).parse(input.get("mode"));
    const confirm = String(input.get("confirm") ?? "");
    return restoreBackup(db, owner, await readFile(input), { mode, confirm });
  });
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

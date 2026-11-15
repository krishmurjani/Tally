"use client";

import { useCallback, useState } from "react";
import type { SaveState } from "@/components/save-status";
import type { ActionResult } from "@/server/repos/errors";
import { withRetry } from "./retry";

/**
 * Run a server action with honest UI states: "saving" → "saved" only after the server confirms.
 * Thrown/network errors get a bounded retry; typed failures (conflict, invalid) are shown, not retried.
 */
export function useAction<A, T>(action: (input: A) => Promise<ActionResult<T>>) {
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const run = useCallback(
    async (input: A): Promise<ActionResult<T> | null> => {
      setState({ kind: "saving" });
      try {
        const res = await withRetry(() => action(input));
        if (res.ok) setState({ kind: "saved" });
        else setState({ kind: "failed", message: res.error === "conflict" ? "it was changed elsewhere — reload and try again" : res.message });
        return res;
      } catch {
        setState({ kind: "failed", message: "couldn't reach the server. Nothing was saved." });
        return null;
      }
    },
    [action],
  );
  return { state, run, pending: state.kind === "saving", reset: () => setState({ kind: "idle" }) };
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

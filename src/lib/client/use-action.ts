"use client";

import { useCallback, useState } from "react";
import type { SaveState } from "@/components/save-status";
import { useToast } from "@/components/toast";
import type { ActionResult } from "@/server/repos/errors";
import { withRetry } from "./retry";

/**
 * Run a server action with honest UI states: "saving" → success only after the server confirms.
 * Success is announced with a toast; failures stay inline next to the control (SaveStatus).
 * Thrown/network errors get a bounded retry; typed failures (conflict, invalid) are shown, not retried.
 */
export function useAction<A, T>(action: (input: A) => Promise<ActionResult<T>>, opts: { success?: string | ((data: T) => string) | false } = {}) {
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const toast = useToast();
  const { success } = opts;
  const run = useCallback(
    async (input: A): Promise<ActionResult<T> | null> => {
      setState({ kind: "saving" });
      try {
        const res = await withRetry(() => action(input));
        if (res.ok) {
          setState({ kind: "saved" });
          if (success !== false) toast({ text: typeof success === "function" ? success(res.data) : (success ?? "Saved") });
        } else {
          setState({ kind: "failed", message: res.error === "conflict" ? "it was changed elsewhere — reload and try again" : res.message });
        }
        return res;
      } catch {
        setState({ kind: "failed", message: "couldn't reach the server. Nothing was saved." });
        return null;
      }
    },
    [action, success, toast],
  );
  return { state, run, pending: state.kind === "saving", reset: () => setState({ kind: "idle" }) };
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

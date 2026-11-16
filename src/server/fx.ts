import "server-only";
import { parseFrankfurter, type LiveFx } from "@/engines/loan/fx";

const URL_ = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR";

/** Fetch today's rate. Nothing about you is sent. Cached for an hour; throws on a bad or missing answer. */
export async function fetchLiveInrPerUsd(): Promise<LiveFx & { source: string }> {
  const res = await fetch(URL_, { signal: AbortSignal.timeout(6000), next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`The exchange-rate service answered ${res.status}`);
  const fx = parseFrankfurter(await res.json());
  if (!fx) throw new Error("The exchange-rate service sent something unexpected");
  return { ...fx, source: "European Central Bank, via frankfurter.dev" };
}

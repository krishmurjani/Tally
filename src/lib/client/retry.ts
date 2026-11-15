/**
 * Bounded retry with backoff for transient failures (network errors / thrown server errors).
 * Typed `{ ok: false }` results are NOT retried — a conflict or validation error won't fix itself.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: { attempts?: number; baseMs?: number } = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseMs ?? 400;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, base * 3 ** i));
    }
  }
  throw lastError;
}

/** Thrown when an edit was based on a stale version of a record. */
export class ConflictError extends Error {
  constructor(public readonly entity: string, public readonly id: string) {
    super(`${entity} was changed elsewhere — reload and try again`);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends Error {
  constructor(public readonly entity: string, public readonly id: string) {
    super(`${entity} not found`);
    this.name = "NotFoundError";
  }
}

/** An error whose message is safe and useful to show as-is (e.g. "Resolve 2 items before closing"). */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/** Result shape returned by server actions to the UI (never "saved" unless the server confirmed it). */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: "unauthorized" | "conflict" | "invalid" | "not_found" | "server"; message: string };

/**
 * Errors as values. Every fetch task resolves to one of these rather than rejecting,
 * which is what lets the fan-out use Promise.all without one bad city taking the
 * whole run down with it.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

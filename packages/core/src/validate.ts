/**
 * Type guards for parsing untrusted JSON.
 *
 * Both the platform's own envelope parser and every game's `parseAction`
 * need the same handful of predicates. Keeping them here means a game author
 * writing a new parser is never tempted to hand-roll a looser check.
 */

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const isString = (v: unknown): v is string => typeof v === 'string';

export const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

export const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

export const isInt = (v: unknown): v is number => isFiniteNumber(v) && Number.isInteger(v);

/** An integer within an inclusive range. */
export const isIntIn = (v: unknown, min: number, max: number): v is number =>
  isInt(v) && v >= min && v <= max;

/** A non-negative integer. */
export const isCount = (v: unknown): v is number => isInt(v) && v >= 0;

/** An array whose every element satisfies `guard`. */
export function isArrayOf<T>(v: unknown, guard: (x: unknown) => x is T): v is T[] {
  return Array.isArray(v) && v.every(guard);
}

/** Narrows to one of a fixed set of string literals. */
export function isOneOf<T extends string>(v: unknown, options: readonly T[]): v is T {
  return isString(v) && (options as readonly string[]).includes(v);
}

/** C0 controls plus DEL. Never legal in a name, a chat line or a join code. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/**
 * Trims free text and clamps it to `max`, stripping control characters so a
 * name or chat line can never contain newlines, ANSI escapes or NULs.
 */
export function sanitiseText(value: string, max: number): string {
  return value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

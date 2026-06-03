/**
 * Recursively freezes an object and all nested plain objects/arrays.
 * Non-plain values (class instances, functions, etc.) are left as-is.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);

  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }

  return value;
}

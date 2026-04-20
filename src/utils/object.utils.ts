/**
 * Returns true if `value` is a plain object (not array, not null, not Date...).
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Strips keys from `item` that are not declared in `definition`.
 * Useful for sanitizing input before persistence.
 */
export function stripUnknownKeys<T extends object>(
  item: Record<string, unknown>,
  definition: Record<string, unknown>
): T {
  const knownKeys = Object.keys(definition) as (keyof T)[];
  return Object.fromEntries(
    knownKeys.filter(k => k in item).map((k): [string, unknown] => [k as string, item[k as string]])
  ) as unknown as T;
}

/**
 * Picks only the listed keys from an object.
 */
export function pick<T extends object, K extends keyof T>(item: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.filter(k => k in item).map(k => [k, item[k]])) as Pick<T, K>;
}

/**
 * Omits the listed keys from an object.
 */
export function omit<T extends object, K extends keyof T>(item: T, keys: K[]): Omit<T, K> {
  const excluded = new Set<string>(keys as string[]);
  return Object.fromEntries(Object.entries(item).filter(([k]) => !excluded.has(k))) as Omit<T, K>;
}

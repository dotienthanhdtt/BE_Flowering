/**
 * Converts a camelCase key to snake_case.
 * Example: "displayName" → "display_name"
 */
export function camelToSnakeKey(key: string): string {
  return key.replace(/([A-Z])/g, '_$1').toLowerCase();
}

/**
 * Converts a snake_case key to camelCase.
 * Example: "display_name" → "displayName"
 */
export function snakeToCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Recursively converts all object keys from camelCase to snake_case.
 * Passes through: null, undefined, Date, primitives, arrays (recurses into elements).
 */
export function toSnakeCase(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(toSnakeCase);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        camelToSnakeKey(k),
        toSnakeCase(v),
      ]),
    );
  }
  return value;
}

/**
 * Recursively converts all object keys from snake_case to camelCase.
 * Passes through: null, undefined, Date, primitives, arrays (recurses into elements).
 */
export function toCamelCase(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(toCamelCase);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        snakeToCamelKey(k),
        toCamelCase(v),
      ]),
    );
  }
  return value;
}

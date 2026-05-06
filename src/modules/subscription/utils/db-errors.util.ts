/**
 * Database error helpers for the subscription module.
 * Centralises PG error-code checks so they don't leak across multiple call-sites.
 */

/** Postgres error code for unique_violation (duplicate key). */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Returns true when `err` is a PostgreSQL unique-constraint violation (code 23505).
 * Works with both the raw pg `DatabaseError` and TypeORM-wrapped errors, both of
 * which expose `.code` on the top-level error object.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === PG_UNIQUE_VIOLATION;
}

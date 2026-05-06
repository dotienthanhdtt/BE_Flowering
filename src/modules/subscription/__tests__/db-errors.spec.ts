import { isUniqueViolation } from '../utils/db-errors.util';

describe('isUniqueViolation', () => {
  it('should detect PostgreSQL unique_violation (code 23505)', () => {
    const error = new Error('duplicate key');
    (error as { code?: string }).code = '23505';
    expect(isUniqueViolation(error)).toBe(true);
  });

  it('should ignore other error codes', () => {
    const error = new Error('some error');
    (error as { code?: string }).code = '42P01';
    expect(isUniqueViolation(error)).toBe(false);
  });

  it('should handle null/undefined errors gracefully', () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it('should handle objects without code property', () => {
    const error = { message: 'error' };
    expect(isUniqueViolation(error)).toBe(false);
  });

  it('should handle non-string code values', () => {
    const error = { code: 23505 } as unknown;
    expect(isUniqueViolation(error)).toBe(false);
  });
});

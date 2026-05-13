import { sanitizeTitle, sanitizeDescription } from './scenario-text-sanitizer';

describe('sanitizeTitle', () => {
  it('strips HTML tags', () => {
    expect(sanitizeTitle('<script>alert(1)</script>Hello')).toBe('Hello');
  });

  it('strips control characters', () => {
    expect(sanitizeTitle('A\x00B\x07C')).toBe('ABC');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeTitle('  hello  ')).toBe('hello');
  });

  it('caps title at 255 characters', () => {
    const long = 'a'.repeat(300);
    const result = sanitizeTitle(long);
    expect(result.length).toBe(255);
  });

  it('preserves Unicode letters (Vietnamese diacritics)', () => {
    const input = 'Xin chào thế giới';
    expect(sanitizeTitle(input)).toBe('Xin chào thế giới');
  });

  it('preserves emoji', () => {
    const input = 'Hello 🌍';
    expect(sanitizeTitle(input)).toBe('Hello 🌍');
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeTitle(null)).toBe('');
    expect(sanitizeTitle(42)).toBe('');
    expect(sanitizeTitle(undefined)).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeTitle('   ')).toBe('');
  });
});

describe('sanitizeDescription', () => {
  it('strips HTML and returns cleaned string', () => {
    expect(sanitizeDescription('<b>Bold</b> text')).toBe('Bold text');
  });

  it('returns undefined for non-string input', () => {
    expect(sanitizeDescription(null)).toBeUndefined();
    expect(sanitizeDescription(42)).toBeUndefined();
  });

  it('returns undefined when result is empty after stripping', () => {
    expect(sanitizeDescription('   ')).toBeUndefined();
    expect(sanitizeDescription('<br/>')).toBeUndefined();
  });

  it('preserves Unicode in description', () => {
    expect(sanitizeDescription('Học tiếng Anh')).toBe('Học tiếng Anh');
  });
});

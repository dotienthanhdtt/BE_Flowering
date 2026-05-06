import { matchesWord } from './vocabulary-usage-matcher';

describe('matchesWord', () => {
  it('1. "hello" matches "Say hello, friend" (case-insensitive, word-boundary)', () => {
    expect(matchesWord('Say hello, friend', 'hello')).toBe(true);
  });

  it('2. "hello" does NOT match "helloworld"', () => {
    expect(matchesWord('helloworld', 'hello')).toBe(false);
  });

  it('3. CJK substring: "こんにちは" matches text containing it', () => {
    expect(matchesWord('今日こんにちは', 'こんにちは')).toBe(true);
  });

  it('4. empty word → false', () => {
    expect(matchesWord('some text', '')).toBe(false);
    expect(matchesWord('some text', '   ')).toBe(false);
  });

  it('5. "c++" does not throw and returns false when not present', () => {
    expect(() => matchesWord('I use JavaScript', 'c++')).not.toThrow();
    expect(matchesWord('I use JavaScript', 'c++')).toBe(false);
  });

  it('6. "café" matches "le café" (Latin case-insensitive)', () => {
    expect(matchesWord('le café au lait', 'café')).toBe(true);
  });
});

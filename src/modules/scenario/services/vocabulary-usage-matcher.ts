const CJK_RANGE = /[぀-鿿가-힯]/;
const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(s: string): string {
  return s.replace(REGEX_ESCAPE, '\\$&');
}

/**
 * Returns true if `word` appears as a standalone token inside `text`.
 * - CJK / ideographic scripts: substring match (no word boundaries).
 * - ASCII-only words: fast \b word-boundary regex.
 * - Latin-extended words (e.g. accented chars): Unicode-aware boundary check
 *   using lookbehind/lookahead to avoid false positives like "hello" in "helloworld".
 */
export function matchesWord(text: string, word: string): boolean {
  const w = word.trim();
  if (!w || !text) return false;
  if (CJK_RANGE.test(w)) return text.toLowerCase().includes(w.toLowerCase());
  try {
    // Check if word contains non-ASCII word chars (accented letters etc.)
    const hasUnicodeLetter = [...w].some((ch) => ch.charCodeAt(0) > 0x7f);
    if (hasUnicodeLetter) {
      // Use Unicode-aware boundary: assert preceding char is non-word or start, same for trailing
      const escaped = escapeRegex(w);
      return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(text);
    }
    return new RegExp(`\\b${escapeRegex(w)}\\b`, 'i').test(text);
  } catch {
    return false;
  }
}

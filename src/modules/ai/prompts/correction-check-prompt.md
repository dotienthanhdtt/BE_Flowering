Grammar checker for {{targetLanguage}}.

Context: """{{previousAiMessage}}"""
Reply: """{{userMessage}}"""

Tasks:
1. Fix any grammar errors in Reply, including wrong word forms (ignore punctuation and capitalization)
2. If Reply is a fragment, expand it into a full sentence based on Context
3. If Reply contains words from another language, replace them with correct {{targetLanguage}} equivalents

Output rules:
- If Reply is already a correct full sentence in {{targetLanguage}}: respond exactly `null`
- Otherwise: return the corrected full reply. Wrap only grammar fixes and language replacements with <span style="color:#EF4444">word</span>. Do not highlight words added for sentence completion.
- Omit words that should be removed.
- If Reply has no recognizable words (gibberish, emojis only): respond exactly `null`
- No explanation. No quotes. No wrapping.
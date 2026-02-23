Check the following {{targetLanguage}} text for grammar errors.

Text to check:
"""
{{text}}
"""

Analyze the text and respond ONLY with a valid JSON object (no markdown, no explanation outside JSON):

{
  "isCorrect": boolean,
  "errors": [
    {
      "original": "incorrect phrase",
      "correction": "correct phrase",
      "explanation": "brief explanation of the grammar rule"
    }
  ],
  "correctedText": "full corrected text"
}

Rules:
- If text is correct, set isCorrect to true and errors to empty array
- Focus on grammar, spelling, and natural phrasing
- Keep explanations concise and educational
- correctedText should be the complete text with all fixes applied

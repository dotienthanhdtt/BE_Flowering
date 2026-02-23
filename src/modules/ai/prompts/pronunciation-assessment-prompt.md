Assess the pronunciation accuracy by comparing transcribed speech to expected text.

Language: {{targetLanguage}}

Expected text:
"""
{{expectedText}}
"""

Transcribed text (what the user actually said):
"""
{{transcribedText}}
"""

Respond ONLY with a valid JSON object (no markdown, no explanation outside JSON):

{
  "score": 0-100,
  "feedback": "overall feedback on pronunciation",
  "errors": [
    {
      "word": "mispronounced word",
      "issue": "what was wrong (e.g., 'said X instead of Y')",
      "suggestion": "how to improve"
    }
  ]
}

Scoring guidelines:
- 90-100: Excellent, native-like pronunciation
- 70-89: Good, minor errors but understandable
- 50-69: Fair, noticeable errors affecting clarity
- 30-49: Needs improvement, significant errors
- 0-29: Major pronunciation issues

Be encouraging but honest in feedback. Focus on the most impactful improvements.

Extract structured user profile data from the following onboarding conversation transcript. Return ONLY a JSON object, no other text.

## Conversation Transcript
{{transcript}}

## Required JSON Schema
```json
{
  "name": "string or null",
  "age": "number or null",
  "job": "string or null",
  "region": "string or null (country or region name)",
  "learningMotivation": "string or null (brief 1-sentence summary)",
  "suggestedProficiency": "beginner | intermediate | advanced (infer from conversation)"
}
```

## Rules
- Extract ONLY information explicitly stated or clearly implied by the user
- Use null for any field not mentioned in the conversation
- For age, extract a number if possible (e.g., "I'm in my 20s" -> 25)
- For suggestedProficiency, default to "beginner" if unclear
- Return valid JSON only, wrapped in ```json``` code block

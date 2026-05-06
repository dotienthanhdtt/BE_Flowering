Extract a structured user profile from the personalization conversation below. Return ONLY a JSON object.

## Conversation Transcript
{{transcript}}

## Required JSON Schema
```json
{
  "job": "string or null (current role/title)",
  "industry": "string or null",
  "currentProject": "string or null (brief description of what they're working on)",
  "upcomingEvent": "string or null (travel, presentation, meeting, etc.)",
  "recentInterest": "string or null (new hobby or activity)",
  "region": "string or null (country or city they're in)",
  "suggestedProficiency": "beginner | intermediate | advanced"
}
```

## Rules
- Extract ONLY information explicitly stated or clearly implied
- Use null for any field not mentioned
- For suggestedProficiency, infer from vocabulary sophistication and context; default "intermediate"
- Return valid JSON only, wrapped in ```json``` code block

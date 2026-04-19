You are a language learning content creator. Generate {{count}} lesson drafts for learning {{languageName}} ({{languageCode}}) at {{level}} level.
{{topicHintLine}}

Return a JSON array (no markdown fences) with exactly {{count}} objects, each with:
- title: string (concise lesson title, max 80 chars)
- description: string (1–2 sentence overview, max 300 chars)
- difficulty: "{{level}}"
- orderIndex: number (0-based, increment per item)
- isPremium: boolean (true for advanced grammar/vocabulary)

Example:
[{"title":"Greetings and Introductions","description":"Learn basic greetings and how to introduce yourself in {{languageName}}.","difficulty":"{{level}}","orderIndex":0,"isPremium":false}]

Return ONLY the JSON array. No explanation.

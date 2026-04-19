You are a language learning content creator. Generate {{count}} conversation scenario drafts for practicing {{languageName}} ({{languageCode}}) at {{level}} level.
{{topicHintLine}}

Return a JSON array (no markdown fences) with exactly {{count}} objects, each with:
- title: string (scenario name, max 80 chars, e.g. "At the Coffee Shop")
- description: string (1–2 sentence context for the role-play, max 300 chars)
- difficulty: "{{level}}"
- accessTier: "free" | "premium" (use "premium" for complex business/formal scenarios)
- orderIndex: number (0-based, increment per item)

Example:
[{"title":"Ordering at a Restaurant","description":"Practice ordering food and drinks in {{languageName}} at a local restaurant.","difficulty":"{{level}}","accessTier":"free","orderIndex":0}]

Return ONLY the JSON array. No explanation.

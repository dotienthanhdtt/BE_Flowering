Generate a {{exerciseType}} exercise for learning {{targetLanguage}}.

Parameters:
- Exercise type: {{exerciseType}}
- Target language: {{targetLanguage}}
- Proficiency level: {{proficiencyLevel}}
- Topic: {{topic}}

Respond ONLY with a valid JSON object (no markdown, no explanation outside JSON):

{
  "type": "{{exerciseType}}",
  "question": "The exercise question or prompt",
  "options": ["option1", "option2", "option3", "option4"],
  "correctAnswer": "the correct answer",
  "explanation": "why this is the correct answer",
  "hints": ["optional hint 1", "optional hint 2"]
}

Guidelines:
- Match difficulty to {{proficiencyLevel}} level
- Make the exercise educational and engaging
- For multiple-choice, provide 4 plausible options
- Include clear explanation for learning
- Hints are optional but helpful for beginners

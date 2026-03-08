# Code Review — Chat Correction Phase (POST /ai/chat/correct)

**Score: 8.5 / 10**

## Scope

- Files reviewed: 6
  - `src/modules/ai/dto/correction-check.dto.ts` (new)
  - `src/modules/ai/prompts/correction-check-prompt.md` (new)
  - `src/modules/ai/dto/index.ts` (modified)
  - `src/modules/ai/services/learning-agent.service.ts` (modified)
  - `src/modules/ai/ai.controller.ts` (modified)
  - `src/modules/ai/services/learning-agent-correction.service.spec.ts` (new)
- Build: PASS (clean, zero errors)
- Tests: 8/8 PASS

## Overall Assessment

Clean, minimal implementation that follows existing patterns well. The LLM response parsing logic is the most fragile part. No security regressions.

---

## Critical Issues

None.

---

## High Priority Findings

### 1. Empty-string `correctedText` treated as valid correction

In `learning-agent.service.ts` line 183:

```ts
const correctedText = trimmed.toLowerCase() === 'null' ? null : trimmed;
```

If the LLM returns an empty string or whitespace-only string, `correctedText` becomes `""` — a falsy but non-null value that the mobile client likely cannot distinguish from a real correction. Add a guard:

```ts
const correctedText = !trimmed || trimmed.toLowerCase() === 'null' ? null : trimmed;
```

### 2. Missing `@IsNotEmpty()` on DTO fields

`CorrectionCheckRequestDto` uses `@IsString()` and `@MaxLength()` but not `@IsNotEmpty()`. An empty string (`""`) for `previousAiMessage` or `userMessage` would pass validation and waste a GPT-4.1 Nano call with a vacuous prompt. Add `@IsNotEmpty()` to all three fields.

---

## Medium Priority Improvements

### 3. `@OptionalAuth()` on an expensive, stateless endpoint — rate-limit gap

The endpoint is unauthenticated-friendly but the `ThrottlerGuard` on the class-level throttles by IP. Anonymous clients can trivially rotate IPs/proxies. Consider adding a tighter per-IP rate limit specifically for this route (e.g., `@Throttle({ default: { limit: 10, ttl: 60000 } })`), since every call hits a paid LLM API.

### 4. Prompt injection surface

`previousAiMessage` and `userMessage` are inserted verbatim into the prompt inside triple-quote delimiters. A user could craft a message containing `"""` to escape the delimiter and inject instructions. The prompt structure is reasonably robust (the injected content is inside labelled context blocks), but the risk is non-zero. Consider stripping or escaping triple-quote sequences before interpolation — a one-liner in `checkCorrection`.

### 5. No `try/catch` in `checkCorrection`

All other service methods in the file also lack try/catch (the `AllExceptionsFilter` handles them globally), so this is consistent with the codebase pattern. No action required — noted for awareness.

---

## Low Priority Suggestions

### 6. `CorrectionCheckResponseDto` field not decorated with `@ApiProperty`

`correctedText` uses `@ApiPropertyOptional` which is correct, but the field initialiser is `!: string | null` (non-null assertion). Since it genuinely can be `null`, using `?: string | null` or keeping `!:` with `nullable: true` in the decorator is fine as-is — just a minor TypeScript strictness nit.

### 7. Test spec file naming convention

Other spec files use `*.service.spec.ts` named after the service (`learning-agent.service.spec.ts`). The new file is `learning-agent-correction.service.spec.ts`. This doesn't break anything but is inconsistent. Preferred: keep it as-is since it isolates `checkCorrection` tests — the name makes the scope clear.

---

## Positive Observations

- Prompt design is tight: explicit null convention, no JSON wrapping, no explanations — reduces parsing complexity significantly.
- Response parsing handles case-insensitive "null", surrounding whitespace, and surrounding quotes — covers the most common LLM quirks.
- `@OptionalAuth()` integration is correct; JWT guard properly reads the metadata key.
- Model choice (GPT-4.1 Nano, temp 0.3) is appropriate for a deterministic correction task.
- Tests are well-structured: pure unit, no DB deps, cover all parsing edge cases.
- File sizes remain well under the 200-line limit.

---

## Recommended Actions

1. **(High)** Add empty-string guard in `checkCorrection`: `!trimmed || trimmed.toLowerCase() === 'null'`
2. **(High)** Add `@IsNotEmpty()` to all three `CorrectionCheckRequestDto` fields
3. **(Medium)** Add stricter throttle on `/ai/chat/correct` for anonymous callers
4. **(Medium)** Strip `"""` from interpolated prompt variables to close prompt-injection vector

---

## Unresolved Questions

- Does the mobile client distinguish `correctedText: ""` from `correctedText: null`? If not, the empty-string guard (item 1) is critical.
- Is there an intention to log correction requests for Langfuse tracing? Currently `metadata` only has `feature: 'correction-check'` — no `userId`. For authenticated callers `userId` is available via `req.user` but is not being threaded through; this may be intentional given `@OptionalAuth()`.

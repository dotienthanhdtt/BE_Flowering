# Phase 02 — Switch scenario chat to 9router + Gemini fallback + tests/docs

**Priority:** High · **Status:** pending · **Depends on:** Phase 01
Point scenario roleplay chat at `flowering_chat`, add a one-shot Gemini fallback on 9router failure,
update tests and docs.

## Context
- `src/modules/scenario/services/scenario-chat.service.ts` — `private readonly defaultModel = LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW;` (line ~49); used at line ~156 in `chat()` via `this.llmService.chat(messages, { model: this.defaultModel, metadata: {...} })`. It calls `.chat()` (non-streaming) and parses `{reply, is_end}` via `parseScenarioReply`.
- `src/modules/scenario/services/scenario-chat.service.spec.ts` — existing unit tests (mocks `UnifiedLLMService`).
- `LangfuseFeature` enum — used in metadata `feature` tag.
- Other surfaces (`LearningAgentService`, `intake-chat-engine.service.ts`) — **do not touch**.

## Related code files
**Modify**
- `src/modules/scenario/services/scenario-chat.service.ts`
- `src/modules/scenario/services/scenario-chat.service.spec.ts`
- `docs/system-architecture.md`, `docs/api-documentation.md`, `docs/code-standards.md` — note new provider (brief)
- `docs/project-changelog.md` — add entry

**Create**
- `src/modules/ai/providers/ninerouter-llm.provider.spec.ts`

## Implementation steps

1. **`scenario-chat.service.ts`**
   - Change default: `private readonly defaultModel = LLMModel.NINEROUTER_FLOWERING_CHAT;`
   - Add fallback constant: `private readonly fallbackModel = LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW;`
   - Wrap the LLM call in `chat()`. Extract a small private helper to keep `chat()` readable:
     ```ts
     private async invokeWithFallback(
       messages: BaseMessage[],
       metadata: Record<string, unknown>,
     ): Promise<string> {
       try {
         return await this.llmService.chat(messages, { model: this.defaultModel, metadata });
       } catch (err) {
         if (err instanceof ServiceUnavailableException) {
           this.logger.warn(
             `9router unavailable for scenario chat; falling back to Gemini. ${String(err.message)}`,
           );
           return this.llmService.chat(messages, {
             model: this.fallbackModel,
             metadata: { ...metadata, fallback: 'ninerouter->gemini' },
           });
         }
         throw err;
       }
     }
     ```
   - Replace the existing `await this.llmService.chat(messages, { model: this.defaultModel, metadata: {...} })` call site with `await this.invokeWithFallback(messages, {...metadata})`. Keep the existing metadata fields (userId, feature, conversationId, etc.) unchanged.
   - Import `ServiceUnavailableException` from `@nestjs/common` (already importing other exceptions there).
   - Keep file < 200 lines — if it tips over, that's pre-existing; the helper adds ~15 lines. (Current ~300+ lines? check — if already over, do not expand scope; just add the minimal helper. Splitting the file is out of scope.)

2. **`ninerouter-llm.provider.spec.ts`** — mirror `openai-stt.provider.spec.ts` style:
   - `chat()`/`stream()` throw `ServiceUnavailableException` when `ai.nineRouterKey` is empty/undefined.
   - With a key configured and `ChatOpenAI` mocked, `chat()` returns the model's string content; `stream()` yields chunks.
   - Verify `ChatOpenAI` constructed with `configuration.baseURL` ending in `/v1` and `openAIApiKey` = the configured key.

3. **`scenario-chat.service.spec.ts`**
   - Update/add assertion: the model passed to `llmService.chat` in the happy path is `LLMModel.NINEROUTER_FLOWERING_CHAT` (`'flowering_chat'`).
   - New test: when `llmService.chat` rejects with `ServiceUnavailableException` on the first call, the service calls it again with `LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW` and returns that result; logger.warn called.
   - New test: a non-`ServiceUnavailableException` error propagates (no fallback).

4. **Docs**
   - `docs/system-architecture.md` — in the AI/LLM provider section, add `NineRouterLLMProvider` (OpenAI-compatible gateway, model alias `flowering_chat`) and note scenario chat routes through it with Gemini fallback.
   - `docs/api-documentation.md` — if it lists models per feature, note scenario chat uses `flowering_chat`.
   - `docs/code-standards.md` — add `NINEROUTER_URL` / `NINEROUTER_KEY` to the env var list if such a list exists.
   - `docs/project-changelog.md` — add a dated entry: "Added 9router LLM provider; scenario roleplay chat now uses `flowering_chat` with Gemini fallback."

5. **Verify**
   - `npm run build` clean.
   - `npm test` — all green, including new/updated specs.
   - Manual smoke (optional, requires real key): `curl` the reference endpoint to confirm `flowering_chat` responds, then hit `POST /scenarios/chat` and confirm a reply.

## Todo
- [ ] `scenario-chat.service.ts`: default model + `invokeWithFallback` helper + call-site swap
- [ ] `ninerouter-llm.provider.spec.ts`
- [ ] `scenario-chat.service.spec.ts`: model assertion + fallback tests
- [ ] Docs: system-architecture, api-documentation, code-standards, changelog
- [ ] `npm run build` + `npm test` green

## Success criteria
- Scenario chat hits `flowering_chat` by default; on 9router `ServiceUnavailableException` it transparently retries with Gemini and still returns a parseable `{reply, is_end}`.
- `/ai/chat` tutor and onboarding intake behavior unchanged (still Gemini).
- All tests pass; build clean.

## Risks
- If 9router returns malformed (non-JSON) content, `parseScenarioReply` handling is the same as today's Gemini path — no regression, but the fallback won't trigger (it only triggers on `ServiceUnavailableException`, not parse failure). Acceptable per brainstorm scope.
- Langfuse traces will show `model: flowering_chat` — the underlying provider behind the alias is opaque in traces. Acceptable.

## Security
- No new auth surface. The only new secret is `NINEROUTER_KEY` (handled in Phase 01).

## Next steps
- After merge: set `NINEROUTER_KEY` (and optionally `NINEROUTER_URL`) in Railway env for dev/prod. Without the key, scenario chat will fall back to Gemini on every request — functional but not the intended path; verify the key is set post-deploy.

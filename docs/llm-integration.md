# LLM Integration

Reference for the Large Language Model (LLM) layer of the AI module
(`src/modules/ai/`). Covers the provider abstraction, the four concrete
providers, model routing, configuration, tracing, and error handling.

> Scope: **LLM only.**
> providers live in the same `providers/` directory but are not covered here.

---

## 1. Overview

The LLM layer is a **provider-abstraction with model-based routing**. Consumers
never touch a vendor SDK directly — they call `UnifiedLLMService`, which routes
to the correct provider based on the requested model.

```
Consumer service                  UnifiedLLMService              Concrete provider
(LearningAgent, Translation,  ──►  getProvider(model)       ──►   OpenAILLMProvider
 ScenarioChat, IntakeChat,         switch on provider type        AnthropicLLMProvider
 AdminContent, ScenarioEval)       wraps in OTel context          GeminiLLMProvider
                                                                  NineRouterLLMProvider
                                                                       │
                                                                  LangChain Chat* client
                                                                       │
                                                                  Vendor API / 9router gateway
```

Cross-cutting concerns (Langfuse tracing) are injected at the provider layer so
no consumer or service duplicates them.

### Key files

| File | Responsibility |
|------|----------------|
| `providers/llm-provider.interface.ts` | The `LLMProvider` contract + `LLMOptions` |
| `providers/llm-models.enum.ts` | `LLMModel` enum, `ThinkingLevel`, `getProviderFromModel()` |
| `providers/openai-llm.provider.ts` | OpenAI provider |
| `providers/anthropic-llm.provider.ts` | Anthropic provider |
| `providers/gemini-llm.provider.ts` | Google Gemini provider |
| `providers/ninerouter-llm.provider.ts` | 9router OpenAI-compatible gateway provider |
| `services/unified-llm.service.ts` | Routing facade — the single entry point |
| `services/langfuse-tracing.service.ts` | OTel context + Langfuse callback handler |
| `langfuse-feature.enum.ts` | Trace feature tags |

---

## 2. The provider contract

`LLMProvider` (`providers/llm-provider.interface.ts`) — every provider
implements exactly two methods:

```ts
export interface LLMProvider {
  chat(messages: BaseMessage[], options: LLMOptions): Promise<string>;
  stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string>;
}
```

- `chat()` — single request/response, returns the full completion string.
- `stream()` — async generator yielding text chunks as they arrive.

`messages` are LangChain `BaseMessage[]` (`HumanMessage`, `SystemMessage`, …).
Non-string content is `JSON.stringify`-ed defensively.

### LLMOptions

```ts
export interface LLMOptions {
  model: LLMModel;                                  // required — drives routing
  temperature?: number;                             // default 0
  topP?: number;
  maxTokens?: number;
  thinkingConfig?: { thinkingLevel: ThinkingLevel };// Gemini extended thinking only
  metadata?: Record<string, unknown>;               // tracing tags (feature, conversationId)
}
```

`metadata.feature` should be a `LangfuseFeature` value — it becomes the
Langfuse trace `runName`.

---

## 3. Models & routing

### LLMModel enum

Enum values are the **actual API model names** sent to the vendor.

| Enum | Value | Provider |
|------|-------|----------|
| `OPENAI_GPT4O` | `gpt-4o` | OpenAI |
| `OPENAI_GPT4O_MINI` | `gpt-4o-mini` | OpenAI |
| `OPENAI_O1_PREVIEW` | `o1-preview` | OpenAI |
| `OPENAI_O1_MINI` | `o1-mini` | OpenAI |
| `OPENAI_GPT4_1_NANO` | `gpt-4.1-nano` | OpenAI |
| `ANTHROPIC_CLAUDE_3_5_SONNET` | `claude-3-5-sonnet-20241022` | Anthropic |
| `ANTHROPIC_CLAUDE_3_HAIKU` | `claude-3-haiku-20240307` | Anthropic |
| `GEMINI_3_1_FLASH_LITE_PREVIEW` | `gemini-3.1-flash-lite` | Gemini |
| `NINEROUTER_FLOWERING_CHAT` | `flowering_chat` | 9router |

### Routing logic — `getProviderFromModel()`

1. If the model is in the explicit `NINEROUTER_MODELS` set → `ninerouter`.
2. Else prefix match: `gpt-` / `o1` → `openai`; `claude-` → `anthropic`;
   `gemini-` → `gemini`.
3. No match → throws `Error("Unknown model provider for: …")`.

> 9router aliases (e.g. `flowering_chat`) do not follow a prefix convention, so
> they are matched by explicit set membership before prefix checks run.

### ThinkingLevel

`LOW | MEDIUM | HIGH` — passed via `LLMOptions.thinkingConfig` and only honored
by the **Gemini** provider (forwarded as `thinkingConfig` to
`ChatGoogleGenerativeAI`). Other providers ignore it.

---

## 4. The four providers

All four wrap a LangChain `Chat*` client, attach the Langfuse callback handler,
and translate any vendor error into a uniform
`ServiceUnavailableException('AI service temporarily unavailable')`.

| Provider | LangChain client | SDK package | Notes |
|----------|------------------|-------------|-------|
| `OpenAILLMProvider` | `ChatOpenAI` | `@langchain/openai` | GPT-4o family + o1 |
| `AnthropicLLMProvider` | `ChatAnthropic` | `@langchain/anthropic` | `maxTokens` defaults to 4096 |
| `GeminiLLMProvider` | `ChatGoogleGenerativeAI` | `@langchain/google-genai` | supports `thinkingConfig`; richer structured failure logging via `logFailure()` |
| `NineRouterLLMProvider` | `ChatOpenAI` (custom `baseURL`) | `@langchain/openai` | OpenAI-compatible gateway, "one key, many providers" |

### 9router provider

`NineRouterLLMProvider` is itself a **proxy-of-a-proxy**: it points
LangChain's `ChatOpenAI` at a self-hosted OpenAI-compatible gateway
(`${nineRouterUrl}/v1`). Model names are server-side aliases configured on the
9router instance, not vendor model IDs.

### Common per-provider behavior

- Each `createModel()` reads its API key from `ConfigService`. Missing key →
  `ServiceUnavailableException('<Vendor> API key not configured')`.
- `temperature` defaults to `0` when not supplied.
- `runName` for tracing = `metadata.feature` (falls back to `undefined`).
- A new LangChain client is constructed **per call** (stateless; key/config read
  fresh each time).

---

## 5. UnifiedLLMService — the entry point

`services/unified-llm.service.ts` is the only class consumers should depend on.

```ts
async chat(messages: BaseMessage[], options: LLMOptions): Promise<string>
async *stream(messages: BaseMessage[], options: LLMOptions): AsyncIterable<string>
```

Responsibilities:

1. **Route** — `getProvider(options.model)` resolves the concrete provider via
   `getProviderFromModel()` + a `switch`.
2. **Trace context** — wraps the provider call in the conversation's OpenTelemetry
   context (`langfuseService.getConversationContext(metadata)` +
   `context.with(...)`) so Langfuse traces nest hierarchically under the
   conversation.

It adds **no** retry, fallback, or caching — a provider failure surfaces directly
to the caller as `ServiceUnavailableException`.

`UnifiedLLMService` is exported by `AiModule`, so other modules
(`scenario`, `admin-content`) can inject it.

---

## 6. Configuration

LLM config lives under the `ai` key of `AppConfiguration`
(`src/config/app-configuration.ts`):

| Config path | Env var | Required | Default |
|-------------|---------|----------|---------|
| `ai.openaiApiKey` | `OPENAI_API_KEY` | for OpenAI models | — |
| `ai.anthropicApiKey` | `ANTHROPIC_API_KEY` | for Anthropic models | — |
| `ai.googleAiApiKey` | `GOOGLE_AI_API_KEY` | for Gemini models | — |
| `ai.nineRouterUrl` | `NINEROUTER_URL` | for 9router models | `https://9router-dev.up.railway.app` |
| `ai.nineRouterKey` | `NINEROUTER_KEY` | for 9router models | — |

Keys are **optional at boot** — the app starts without them. A model whose key
is missing fails only when first called, with a clear
`ServiceUnavailableException`.

---

## 7. Tracing — Langfuse

Every provider attaches `langfuseService.getHandler(metadata)` as a LangChain
callback. The trace is labelled by `metadata.feature`, which must be a value
from `LangfuseFeature` (`langfuse-feature.enum.ts`):

`correction-check`, `onboarding-chat`, `onboarding-extraction`,
`onboarding-scenarios`, `translate-word`, `translate-sentence`,
`translate-chunk`, `scenario-chat`, `admin-content-generate`,
`personalization-chat`, `personalization-extraction`,
`personalization-scenarios`, `scenario-evaluation`.

Pass `conversationId` in `metadata` to nest the call under a conversation trace.

---

## 8. Error handling

| Failure | Behavior |
|---------|----------|
| Missing API key | `ServiceUnavailableException('<Vendor> API key not configured')` at call time |
| Vendor API error / timeout | Logged, then `ServiceUnavailableException('AI service temporarily unavailable')` |
| Unknown model | `getProviderFromModel()` throws a plain `Error` |

There is **no automatic failover between LLM providers**. Resilience for
multi-provider routing, if needed, is expected to be handled server-side by the
9router gateway (use a 9router model alias rather than a direct vendor model).

The global `AllExceptionsFilter` ensures these never reach the client as raw
exceptions — they become the standard `{code: 0, message, data}` envelope.

---

## 9. Usage example

```ts
import { HumanMessage } from '@langchain/core/messages';
import { LLMModel, ThinkingLevel } from '../providers/llm-models.enum';
import { LangfuseFeature } from '../langfuse-feature.enum';

const response = await this.llmService.chat([new HumanMessage(prompt)], {
  model: LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW,
  temperature: 0.0,
  maxTokens: 10000,
  thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
  metadata: { feature: LangfuseFeature.CORRECTION_CHECK, conversationId },
});
```

Prompts are loaded via `PromptLoaderService.loadPrompt(filename, vars)`, which
reads cached templates from `src/modules/ai/prompts/` and substitutes
`{{variable}}` placeholders.

Current LLM consumers: `LearningAgentService`, `TranslationService`,
`IntakeChatEngine` (AI module); `ScenarioChatService`,
`ScenarioEvaluatorService`, `AdminContentService` (other modules).

---

## 10. Extending — adding a new model or provider

**New model on an existing provider:** add an entry to `LLMModel`. If its API
name matches an existing prefix rule, routing works automatically; otherwise add
it to the relevant set in `llm-models.enum.ts`.

**New provider:** this requires touching three places —

1. `llm-models.enum.ts` — add models + a `LLMProviderType` + routing branch.
2. Create `providers/<vendor>-llm.provider.ts` implementing `LLMProvider`.
3. `unified-llm.service.ts` — inject it + add a `switch` case.
4. `ai.module.ts` — register the provider class.

> The routing is intentionally a hardcoded `switch`, not a registry — KISS for
> the current small provider count. Revisit only if provider count grows or
> config-driven routing becomes a real requirement.

---

## Open questions

- No LLM-level fallback today — confirm whether 9router server-side failover is
  the intended resilience strategy, or whether a local fallback wrapper (like
  `FallbackTtsProvider` on the TTS side) is wanted.
- `LLMProvider` lacks `name` / `isAvailable()` that STT/TTS providers expose —
  consider adding for boot-time misconfig detection.

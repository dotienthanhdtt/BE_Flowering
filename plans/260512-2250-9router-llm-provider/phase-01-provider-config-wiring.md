# Phase 01 — 9router provider, config, wiring

**Priority:** High · **Status:** pending
Create the `NineRouterLLMProvider`, add config, register the model + provider so `flowering_chat`
resolves through `UnifiedLLMService`. No behavior change to existing providers or surfaces yet.

## Context
- Existing pattern: `src/modules/ai/providers/openai-llm.provider.ts` — `ChatOpenAI` wrapper, ~70 lines, implements `LLMProvider` ({ chat, stream }).
- Routing: `src/modules/ai/providers/llm-models.enum.ts` — `LLMModel` enum, `LLMProviderType` union, `getProviderFromModel()` (prefix heuristics).
- `src/modules/ai/services/unified-llm.service.ts` — `getProvider()` switch.
- `src/modules/ai/ai.module.ts` — DI registration.
- `src/config/environment-validation-schema.ts` + `src/config/app-configuration.ts` — env config (see existing `OPENAI_API_KEY` / `ai.openaiApiKey`).

## Related code files
**Create**
- `src/modules/ai/providers/ninerouter-llm.provider.ts`

**Modify**
- `src/modules/ai/providers/llm-models.enum.ts` — add enum value + `'ninerouter'` to union + routing branch
- `src/modules/ai/providers/index.ts` — export new provider
- `src/modules/ai/services/unified-llm.service.ts` — inject provider + `case 'ninerouter'`
- `src/modules/ai/ai.module.ts` — register `NineRouterLLMProvider`
- `src/config/environment-validation-schema.ts` — `NINEROUTER_URL`, `NINEROUTER_KEY`
- `src/config/app-configuration.ts` — `ai.nineRouterUrl`, `ai.nineRouterKey`
- `.env.example` — `NINEROUTER_URL=https://9router-dev.up.railway.app`, `NINEROUTER_KEY=`

## Implementation steps

1. **`llm-models.enum.ts`**
   - Add to `LLMModel`: `NINEROUTER_FLOWERING_CHAT = 'flowering_chat'` (new section `// 9router (router gateway) Models`).
   - `LLMProviderType` → `'openai' | 'anthropic' | 'gemini' | 'ninerouter'`.
   - In `getProviderFromModel()`, add **before** the prefix checks:
     ```ts
     const NINEROUTER_MODELS = new Set<string>(['flowering_chat']);
     // ...
     if (NINEROUTER_MODELS.has(modelValue)) return 'ninerouter';
     ```
     (Hoist `NINEROUTER_MODELS` to module scope, near the enum.)

2. **`config/environment-validation-schema.ts`** — add alongside the AI keys:
   ```ts
   NINEROUTER_URL: Joi.string().uri().default('https://9router-dev.up.railway.app')
     .description('9router OpenAI-compatible gateway base URL'),
   NINEROUTER_KEY: Joi.string().allow('').optional()
     .description('9router API key (Bearer token)'),
   ```

3. **`config/app-configuration.ts`** — under the `ai` object add:
   ```ts
   nineRouterUrl: process.env.NINEROUTER_URL,
   nineRouterKey: process.env.NINEROUTER_KEY,
   ```

4. **`.env.example`** — add near other AI keys:
   ```
   NINEROUTER_URL=https://9router-dev.up.railway.app
   NINEROUTER_KEY=
   ```
   Do NOT commit the real token.

5. **`providers/ninerouter-llm.provider.ts`** — mirror `openai-llm.provider.ts`:
   ```ts
   @Injectable()
   export class NineRouterLLMProvider implements LLMProvider {
     private readonly logger = new Logger(NineRouterLLMProvider.name);
     constructor(
       private configService: ConfigService<AppConfiguration>,
       private langfuseService: LangfuseService,
     ) {}

     private createModel(modelName: string, options?: LLMOptions): ChatOpenAI {
       const apiKey = this.configService.get('ai.nineRouterKey', { infer: true });
       const baseUrl = this.configService.get('ai.nineRouterUrl', { infer: true });
       if (!apiKey) throw new ServiceUnavailableException('9router API key not configured');
       return new ChatOpenAI({
         modelName,
         openAIApiKey: apiKey,
         configuration: { baseURL: `${baseUrl}/v1` },
         temperature: options?.temperature ?? 0,
         topP: options?.topP,
         maxTokens: options?.maxTokens,
         streaming: true,
         callbacks: [this.langfuseService.getHandler(options?.metadata)],
       });
     }
     // chat() and stream() — copy verbatim from OpenAILLMProvider, swap log prefix to '9router'
   }
   ```
   Keep file < 200 lines (it's ~75).

6. **`providers/index.ts`** — `export * from './ninerouter-llm.provider';`

7. **`services/unified-llm.service.ts`**
   - Import + constructor-inject `private nineRouterProvider: NineRouterLLMProvider`.
   - Add `case 'ninerouter': return this.nineRouterProvider;` to `getProvider()` switch.

8. **`ai.module.ts`** — add `NineRouterLLMProvider` to `providers` array (after `GeminiLLMProvider`, before STT providers). No export needed (used only via `UnifiedLLMService`).

9. **Compile check** — `npm run build` (catches `TS2307` / DI typos). Confirm no `Cannot find module`.

## Todo
- [ ] Enum + routing branch + module-scope `NINEROUTER_MODELS`
- [ ] Validation schema + app-configuration + `.env.example`
- [ ] `ninerouter-llm.provider.ts`
- [ ] `providers/index.ts` export
- [ ] `unified-llm.service.ts` wiring
- [ ] `ai.module.ts` registration
- [ ] `npm run build` clean

## Success criteria
- `getProviderFromModel(LLMModel.NINEROUTER_FLOWERING_CHAT) === 'ninerouter'`.
- App boots without 9router key (provider only throws when actually invoked) — graceful, matches OpenAI/Anthropic/Gemini.
- Build passes.

## Risks
- `ChatOpenAI` `configuration.baseURL` must include `/v1` (the underlying `openai` SDK appends `/chat/completions`). Reference curl confirms `/v1/chat/completions`.
- `flowering_chat` is a server-side alias — `temperature`/`maxTokens` we pass are advisory; fine.

## Security
- Bearer token is a secret → env var only, never in `.env.example` or code. Set in Railway vars for deploy.

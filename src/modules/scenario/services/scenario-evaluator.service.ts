import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { UnifiedLLMService } from '@/modules/ai/services/unified-llm.service';
import { PromptLoaderService } from '@/modules/ai/services/prompt-loader.service';
import { LLMModel } from '@/modules/ai/providers/llm-models.enum';
import { LangfuseFeature } from '@/modules/ai/langfuse-feature.enum';
import type { AiConversationMessage } from '@/database/entities/ai-conversation-message.entity';
import { MessageRole } from '@/database/entities/ai-conversation-message.entity';

const LLM_TIMEOUT_MS = 15_000;
const PROMPT_VERSION = 2;

export class EvaluatorError extends Error {
  constructor(public readonly code: 'llm_unavailable' | 'parse_failed' | 'timeout' | 'invalid_response') {
    super(code);
    this.name = 'EvaluatorError';
  }
}

export interface EvaluatorInput {
  scenario: { id: string; title: string; description: string | null };
  messages: AiConversationMessage[];
  langCtx: { targetLanguage: string; nativeLanguage: string; proficiencyLevel: string };
  userId: string;
  conversationId: string;
}

export interface ScenarioEvaluationResult {
  overallScore: number;
  fluencyScore: number;
  accuracyScore: number;
  strengths: string[];
  improvements: string[];
  summary: string;
  modelUsed: string;
  promptVersion: number;
}

@Injectable()
export class ScenarioEvaluatorService {
  // Primary model — same as chat service. Duplicate intentional (YAGNI: extract when 3rd caller appears).
  private readonly defaultModel = LLMModel.NINEROUTER_FLOWERING_CHAT;
  private readonly fallbackModel = LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW;
  private readonly logger = new Logger(ScenarioEvaluatorService.name);

  constructor(
    private readonly llmService: UnifiedLLMService,
    private readonly promptLoader: PromptLoaderService,
  ) {}

  async evaluate(input: EvaluatorInput): Promise<ScenarioEvaluationResult> {
    const prompt = this.buildPrompt(input);
    const messages = [new SystemMessage(prompt), new HumanMessage('Evaluate now.')];
    const metadata = {
      feature: LangfuseFeature.SCENARIO_EVALUATION,
      userId: input.userId,
      conversationId: input.conversationId,
      scenarioId: input.scenario.id,
    };

    const { raw, modelUsed } = await this.invokeLlmWithFallback(messages, metadata);
    return this.parseAndValidate(raw, modelUsed);
  }

  private buildPrompt(input: EvaluatorInput): string {
    const transcript = input.messages
      .filter((m) => m.role === MessageRole.USER || m.role === MessageRole.ASSISTANT)
      .map((m) => `${m.role === MessageRole.USER ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    return this.promptLoader.loadPrompt('scenario-evaluation-prompt.md', {
      targetLanguage: input.langCtx.targetLanguage,
      nativeLanguage: input.langCtx.nativeLanguage,
      proficiencyLevel: input.langCtx.proficiencyLevel,
      scenarioTitle: input.scenario.title,
      scenarioDescription: input.scenario.description ?? '',
      transcript: transcript || '(no messages)',
    });
  }

  // Duplicate of chat service's invokeLlmWithFallback — extract to shared util when a 3rd caller appears (YAGNI).
  private async invokeLlmWithFallback(
    messages: Parameters<UnifiedLLMService['chat']>[0],
    metadata: Record<string, unknown>,
  ): Promise<{ raw: string; modelUsed: string }> {
    const callWithTimeout = (model: LLMModel): Promise<string> => {
      let handle: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => {
        handle = setTimeout(() => reject(new EvaluatorError('timeout')), LLM_TIMEOUT_MS);
      });
      return Promise.race([
        this.llmService.chat(messages, { model, metadata }).finally(() => clearTimeout(handle)),
        timeout,
      ]);
    };

    try {
      const raw = await callWithTimeout(this.defaultModel);
      return { raw, modelUsed: this.defaultModel };
    } catch (err) {
      if (err instanceof EvaluatorError) throw err;
      if (err instanceof ServiceUnavailableException) {
        this.logger.warn(`9router unavailable for evaluation; falling back to Gemini.`);
        try {
          const raw = await callWithTimeout(this.fallbackModel);
          return { raw, modelUsed: this.fallbackModel };
        } catch (fallbackErr) {
          if (fallbackErr instanceof EvaluatorError) throw fallbackErr;
          this.logger.warn(`Gemini fallback also failed: ${String((fallbackErr as Error).message)}`);
          throw new EvaluatorError('llm_unavailable');
        }
      }
      throw new EvaluatorError('llm_unavailable');
    }
  }

  private parseAndValidate(raw: string, modelUsed: string): ScenarioEvaluationResult {
    // Strip markdown fences if LLM wraps output
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      this.logger.warn(`ScenarioEvaluator: JSON.parse failed. Raw length=${raw.length}`);
      throw new EvaluatorError('parse_failed');
    }

    const requiredFields = ['overall_score', 'fluency_score', 'accuracy_score', 'summary'];
    for (const field of requiredFields) {
      if (parsed[field] === undefined || parsed[field] === null) {
        this.logger.warn(`ScenarioEvaluator: missing required field "${field}"`);
        throw new EvaluatorError('invalid_response');
      }
    }

    const clamp = (v: unknown): number => Math.min(100, Math.max(0, Number(v) || 0));
    const toStringArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

    return {
      overallScore: clamp(parsed['overall_score']),
      fluencyScore: clamp(parsed['fluency_score']),
      accuracyScore: clamp(parsed['accuracy_score']),
      strengths: toStringArray(parsed['strengths']),
      improvements: toStringArray(parsed['improvements']),
      summary: typeof parsed['summary'] === 'string' ? parsed['summary'] : '',
      modelUsed,
      promptVersion: PROMPT_VERSION,
    };
  }
}

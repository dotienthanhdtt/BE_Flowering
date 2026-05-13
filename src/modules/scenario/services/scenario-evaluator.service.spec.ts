jest.mock('../../ai/services/unified-llm.service');
jest.mock('../../ai/services/prompt-loader.service');

import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { ScenarioEvaluatorService, EvaluatorError, EvaluatorInput } from './scenario-evaluator.service';
import { UnifiedLLMService } from '../../ai/services/unified-llm.service';
import { PromptLoaderService } from '../../ai/services/prompt-loader.service';
import { LLMModel } from '../../ai/providers/llm-models.enum';
import { MessageRole } from '../../../database/entities/ai-conversation-message.entity';

describe('ScenarioEvaluatorService', () => {
  let module: TestingModule;
  let service: ScenarioEvaluatorService;
  let llmService: any;
  let promptLoader: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    module = await Test.createTestingModule({
      providers: [
        ScenarioEvaluatorService,
        { provide: UnifiedLLMService, useValue: { chat: jest.fn() } },
        { provide: PromptLoaderService, useValue: { loadPrompt: jest.fn() } },
      ],
    }).compile();

    service = module.get<ScenarioEvaluatorService>(ScenarioEvaluatorService);
    llmService = module.get(UnifiedLLMService);
    promptLoader = module.get(PromptLoaderService);
  });

  const mockScenario = {
    id: 'scenario-1',
    title: 'Restaurant Ordering',
    description: 'Learn to order food at a restaurant',
  };

  const mockMessages = [
    { id: 'msg-1', role: MessageRole.USER, content: 'Bonjour, je voudrais commander', createdAt: new Date() },
    { id: 'msg-2', role: MessageRole.ASSISTANT, content: 'Bienvenue! Que désirez-vous?', createdAt: new Date() },
    { id: 'msg-3', role: MessageRole.USER, content: 'Un café, s\'il vous plaît', createdAt: new Date() },
    { id: 'msg-4', role: MessageRole.ASSISTANT, content: 'Excellent choix! Voilà votre café.', createdAt: new Date() },
  ] as any;

  const mockVocab = [
    { id: 'v-1', word: 'bonjour', translation: 'hello', box: 1 } as any,
    { id: 'v-2', word: 'commander', translation: 'to order', box: 2 } as any,
    { id: 'v-3', word: 'café', translation: 'coffee', box: 1 } as any,
  ];

  const mockInput: EvaluatorInput = {
    scenario: mockScenario,
    messages: mockMessages,
    injectedVocab: mockVocab,
    vocabUsageHits: [
      { vocabId: 'v-1', wasUsed: true },
      { vocabId: 'v-2', wasUsed: true },
      { vocabId: 'v-3', wasUsed: true },
    ],
    langCtx: {
      targetLanguage: 'French',
      nativeLanguage: 'English',
      proficiencyLevel: 'intermediate',
    },
    userId: 'user-1',
    conversationId: 'convo-1',
  };

  const validEvaluationJson = {
    overall_score: 85,
    fluency_score: 80,
    accuracy_score: 90,
    vocab_score: 75,
    strengths: ['Good pronunciation', 'Correct grammar'],
    improvements: ['Expand vocabulary'],
    summary: 'Strong performance',
    vocab_usage: [
      { vocab_id: 'v-1', word: 'bonjour', used: true },
      { vocab_id: 'v-2', word: 'commander', used: true },
      { vocab_id: 'v-3', word: 'café', used: true },
    ],
  };

  describe('evaluate', () => {
    it('should parse valid JSON output and return ScenarioEvaluationResult', async () => {
      promptLoader.loadPrompt.mockReturnValue('scenario evaluation prompt');
      llmService.chat.mockResolvedValue(JSON.stringify(validEvaluationJson));

      const result = await service.evaluate(mockInput);

      expect(result).toMatchObject({
        overallScore: 85,
        fluencyScore: 80,
        accuracyScore: 90,
        vocabScore: 75,
        strengths: ['Good pronunciation', 'Correct grammar'],
        improvements: ['Expand vocabulary'],
        summary: 'Strong performance',
        vocabUsage: expect.any(Array),
      });
      expect(result.modelUsed).toBe(LLMModel.NINEROUTER_FLOWERING_CHAT);
      expect(result.promptVersion).toBe(1);
    });

    it('should strip markdown JSON fences (```json...```)', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      llmService.chat.mockResolvedValue(`\`\`\`json\n${JSON.stringify(validEvaluationJson)}\n\`\`\``);

      const result = await service.evaluate(mockInput);

      expect(result.overallScore).toBe(85);
    });

    it('should strip markdown fences without json tag (```...```)', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      llmService.chat.mockResolvedValue(`\`\`\`\n${JSON.stringify(validEvaluationJson)}\n\`\`\``);

      const result = await service.evaluate(mockInput);

      expect(result.overallScore).toBe(85);
    });

    it('should throw EvaluatorError with code "parse_failed" on malformed JSON', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      llmService.chat.mockResolvedValue('{ invalid json }');

      await expect(service.evaluate(mockInput)).rejects.toThrow(EvaluatorError);
      await expect(service.evaluate(mockInput)).rejects.toMatchObject({ code: 'parse_failed' });
    });

    it('should throw EvaluatorError with code "invalid_response" when overall_score is missing', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const incomplete = { ...validEvaluationJson };
      const { overall_score, ...withoutOverall } = incomplete;
      llmService.chat.mockResolvedValue(JSON.stringify(withoutOverall));

      await expect(service.evaluate(mockInput)).rejects.toThrow(EvaluatorError);
      await expect(service.evaluate(mockInput)).rejects.toMatchObject({ code: 'invalid_response' });
    });

    it('should throw EvaluatorError with code "invalid_response" when fluency_score is missing', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const incomplete = { ...validEvaluationJson };
      const { fluency_score, ...withoutFluency } = incomplete;
      llmService.chat.mockResolvedValue(JSON.stringify(withoutFluency));

      await expect(service.evaluate(mockInput)).rejects.toThrow(EvaluatorError);
      await expect(service.evaluate(mockInput)).rejects.toMatchObject({ code: 'invalid_response' });
    });

    it('should throw EvaluatorError with code "invalid_response" when accuracy_score is missing', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const incomplete = { ...validEvaluationJson };
      const { accuracy_score, ...withoutAccuracy } = incomplete;
      llmService.chat.mockResolvedValue(JSON.stringify(withoutAccuracy));

      await expect(service.evaluate(mockInput)).rejects.toThrow(EvaluatorError);
      await expect(service.evaluate(mockInput)).rejects.toMatchObject({ code: 'invalid_response' });
    });

    it('should throw EvaluatorError with code "invalid_response" when vocab_score is missing', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const incomplete = { ...validEvaluationJson };
      const { vocab_score, ...withoutVocab } = incomplete;
      llmService.chat.mockResolvedValue(JSON.stringify(withoutVocab));

      await expect(service.evaluate(mockInput)).rejects.toThrow(EvaluatorError);
      await expect(service.evaluate(mockInput)).rejects.toMatchObject({ code: 'invalid_response' });
    });

    it('should throw EvaluatorError with code "invalid_response" when summary is missing', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const incomplete = { ...validEvaluationJson };
      const { summary, ...withoutSummary } = incomplete;
      llmService.chat.mockResolvedValue(JSON.stringify(withoutSummary));

      await expect(service.evaluate(mockInput)).rejects.toThrow(EvaluatorError);
      await expect(service.evaluate(mockInput)).rejects.toMatchObject({ code: 'invalid_response' });
    });

    it('should throw EvaluatorError with code "invalid_response" when required field is null', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const nullField = { ...validEvaluationJson, summary: null };
      llmService.chat.mockResolvedValue(JSON.stringify(nullField));

      await expect(service.evaluate(mockInput)).rejects.toThrow(EvaluatorError);
      await expect(service.evaluate(mockInput)).rejects.toMatchObject({ code: 'invalid_response' });
    });
  });

  describe('evaluate - score clamping', () => {
    it('should clamp score > 100 to 100', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const overScored = { ...validEvaluationJson, overall_score: 150 };
      llmService.chat.mockResolvedValue(JSON.stringify(overScored));

      const result = await service.evaluate(mockInput);

      expect(result.overallScore).toBe(100);
    });

    it('should clamp score < 0 to 0', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const negativeScore = { ...validEvaluationJson, fluency_score: -10 };
      llmService.chat.mockResolvedValue(JSON.stringify(negativeScore));

      const result = await service.evaluate(mockInput);

      expect(result.fluencyScore).toBe(0);
    });

    it('should handle non-numeric score gracefully (coerce to 0)', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const badScore = { ...validEvaluationJson, accuracy_score: 'not a number' };
      llmService.chat.mockResolvedValue(JSON.stringify(badScore));

      const result = await service.evaluate(mockInput);

      expect(result.accuracyScore).toBe(0);
    });

    it('should handle all score fields independently', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const mixedScores = {
        ...validEvaluationJson,
        overall_score: 150,
        fluency_score: -5,
        accuracy_score: 99,
        vocab_score: 0,
      };
      llmService.chat.mockResolvedValue(JSON.stringify(mixedScores));

      const result = await service.evaluate(mockInput);

      expect(result.overallScore).toBe(100);
      expect(result.fluencyScore).toBe(0);
      expect(result.accuracyScore).toBe(99);
      expect(result.vocabScore).toBe(0);
    });
  });

  describe('evaluate - fallback to Gemini', () => {
    it('should fall back to Gemini when 9router throws ServiceUnavailableException', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      llmService.chat
        .mockRejectedValueOnce(new ServiceUnavailableException('9router is down'))
        .mockResolvedValueOnce(JSON.stringify(validEvaluationJson));

      const result = await service.evaluate(mockInput);

      expect(llmService.chat).toHaveBeenCalledTimes(2);
      expect(llmService.chat).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({ model: LLMModel.NINEROUTER_FLOWERING_CHAT }),
      );
      expect(llmService.chat).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({ model: LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW }),
      );
      expect(result.modelUsed).toBe(LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW);
    });

    it('should throw EvaluatorError("llm_unavailable") if Gemini fallback also fails with ServiceUnavailableException', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      llmService.chat
        .mockRejectedValueOnce(new ServiceUnavailableException('9router down'))
        .mockRejectedValueOnce(new ServiceUnavailableException('Gemini also down'));

      await expect(service.evaluate(mockInput)).rejects.toThrow(EvaluatorError);
    });

    it('should throw EvaluatorError("llm_unavailable") if Gemini fallback returns parse error', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      llmService.chat
        .mockRejectedValueOnce(new ServiceUnavailableException('9router down'))
        .mockResolvedValueOnce('{ invalid }');

      // The fallback parse error is caught and converted to llm_unavailable
      await expect(service.evaluate(mockInput)).rejects.toThrow(EvaluatorError);
    });

    it('should NOT fall back on non-ServiceUnavailable errors', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      llmService.chat.mockRejectedValueOnce(new Error('Network timeout'));

      await expect(service.evaluate(mockInput)).rejects.toThrow(EvaluatorError);
      expect(llmService.chat).toHaveBeenCalledTimes(1);
    });
  });

  describe('evaluate - timeout handling', () => {
    it('should timeout after 15 seconds with EvaluatorError("timeout")', async () => {
      jest.useFakeTimers();
      promptLoader.loadPrompt.mockReturnValue('prompt');

      // llmService.chat never resolves
      llmService.chat.mockImplementation(() => new Promise(() => {}));

      const evaluatePromise = service.evaluate(mockInput);

      // Advance 15 seconds
      jest.advanceTimersByTime(15_000);

      await expect(evaluatePromise).rejects.toThrow(EvaluatorError);
      await expect(evaluatePromise).rejects.toMatchObject({ code: 'timeout' });

      jest.useRealTimers();
    });

    it('should timeout each fallback attempt independently', async () => {
      jest.useFakeTimers();
      promptLoader.loadPrompt.mockReturnValue('prompt');

      // Both calls hang
      llmService.chat.mockImplementation(() => new Promise(() => {}));

      const evaluatePromise = service.evaluate(mockInput);

      jest.advanceTimersByTime(15_000);

      await expect(evaluatePromise).rejects.toThrow(EvaluatorError);
      await expect(evaluatePromise).rejects.toMatchObject({ code: 'timeout' });

      jest.useRealTimers();
    });
  });

  describe('evaluate - prompt building', () => {
    it('should pass correct context to promptLoader.loadPrompt', async () => {
      promptLoader.loadPrompt.mockReturnValue('formatted prompt');
      llmService.chat.mockResolvedValue(JSON.stringify(validEvaluationJson));

      await service.evaluate(mockInput);

      expect(promptLoader.loadPrompt).toHaveBeenCalledWith(
        'scenario-evaluation-prompt.json',
        expect.objectContaining({
          targetLanguage: 'French',
          nativeLanguage: 'English',
          proficiencyLevel: 'intermediate',
          scenarioTitle: 'Restaurant Ordering',
          scenarioDescription: 'Learn to order food at a restaurant',
          transcript: expect.stringContaining('User:'),
          injectedVocab: expect.stringContaining('bonjour'),
          vocabUsageHits: expect.stringContaining('used'),
        }),
      );
    });

    it('should handle null scenario description', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      llmService.chat.mockResolvedValue(JSON.stringify(validEvaluationJson));

      const inputWithNullDesc: EvaluatorInput = {
        ...mockInput,
        scenario: { ...mockScenario, description: null },
      };

      await service.evaluate(inputWithNullDesc);

      expect(promptLoader.loadPrompt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          scenarioDescription: '',
        }),
      );
    });
  });

  describe('evaluate - vocab-usage fallback', () => {
    it('should re-match transcript against injected vocab when vocabUsageHits is empty', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      llmService.chat.mockResolvedValue(JSON.stringify(validEvaluationJson));

      const inputWithoutTracking: EvaluatorInput = {
        ...mockInput,
        vocabUsageHits: [], // No tracked events
      };

      await service.evaluate(inputWithoutTracking);

      const callArgs = promptLoader.loadPrompt.mock.calls[0][1];
      // Should call matchesWord internally and reflect the results
      expect(callArgs.vocabUsageHits).toContain('bonjour: used');
      expect(callArgs.vocabUsageHits).toContain('commander: used');
      expect(callArgs.vocabUsageHits).toContain('café: used');
    });

    it('should mark vocab as "not used" when transcript does not contain it', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      llmService.chat.mockResolvedValue(JSON.stringify(validEvaluationJson));

      // Transcript has "bonjour" and "commander" but not "merci"
      const inputWithNewVocab: EvaluatorInput = {
        ...mockInput,
        injectedVocab: [
          { id: 'v-1', word: 'bonjour', translation: 'hello', box: 1 } as any,
          { id: 'v-2', word: 'commander', translation: 'to order', box: 2 } as any,
          { id: 'v-4', word: 'merci', translation: 'thank you', box: 1 } as any,
        ],
        vocabUsageHits: [],
      };

      await service.evaluate(inputWithNewVocab);

      const callArgs = promptLoader.loadPrompt.mock.calls[0][1];
      expect(callArgs.vocabUsageHits).toContain('merci: not used');
    });

    it('should NOT re-match when vocabUsageHits is already populated', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      llmService.chat.mockResolvedValue(JSON.stringify(validEvaluationJson));

      const inputWithTracking: EvaluatorInput = {
        ...mockInput,
        vocabUsageHits: [
          { vocabId: 'v-1', wasUsed: false }, // explicitly marked as unused
          { vocabId: 'v-2', wasUsed: false },
          { vocabId: 'v-3', wasUsed: false },
        ],
      };

      await service.evaluate(inputWithTracking);

      const callArgs = promptLoader.loadPrompt.mock.calls[0][1];
      expect(callArgs.vocabUsageHits).toContain('bonjour: not used');
      expect(callArgs.vocabUsageHits).toContain('commander: not used');
      expect(callArgs.vocabUsageHits).toContain('café: not used');
    });
  });

  describe('evaluate - response building', () => {
    it('should return empty arrays for strengths and improvements if not provided by LLM', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const minimalEval = {
        overall_score: 75,
        fluency_score: 75,
        accuracy_score: 75,
        vocab_score: 75,
        summary: 'OK',
        // no strengths, improvements, or vocab_usage
      };
      llmService.chat.mockResolvedValue(JSON.stringify(minimalEval));

      const result = await service.evaluate(mockInput);

      expect(result.strengths).toEqual([]);
      expect(result.improvements).toEqual([]);
      expect(result.vocabUsage).toEqual([]);
    });

    it('should return empty string for summary if it is non-string', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const badSummary = { ...validEvaluationJson, summary: 123 };
      llmService.chat.mockResolvedValue(JSON.stringify(badSummary));

      const result = await service.evaluate(mockInput);

      expect(result.summary).toBe('');
    });

    it('should filter vocab_usage to valid items only', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const mixedVocab = {
        ...validEvaluationJson,
        vocab_usage: [
          { vocab_id: 'v-1', word: 'bonjour', used: true },
          { vocab_id: 'v-2', word: 'commander', used: false },
          null, // invalid
          { invalid: 'item' }, // missing vocab_id
          { vocab_id: 'v-3', word: 'café', used: true },
        ],
      };
      llmService.chat.mockResolvedValue(JSON.stringify(mixedVocab));

      const result = await service.evaluate(mockInput);

      expect(result.vocabUsage).toHaveLength(3);
      expect(result.vocabUsage).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ vocab_id: 'v-1' }),
          expect.objectContaining({ vocab_id: 'v-2' }),
          expect.objectContaining({ vocab_id: 'v-3' }),
        ]),
      );
    });
  });
});

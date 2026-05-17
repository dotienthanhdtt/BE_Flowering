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

  const mockInput: EvaluatorInput = {
    scenario: mockScenario,
    messages: mockMessages,
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
    strengths: ['Good pronunciation', 'Correct grammar'],
    improvements: ['Expand vocabulary'],
    summary: 'Strong performance',
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
        strengths: ['Good pronunciation', 'Correct grammar'],
        improvements: ['Expand vocabulary'],
        summary: 'Strong performance',
      });
      expect(result.modelUsed).toBe(LLMModel.NINEROUTER_FLOWERING_CHAT);
      expect(result.promptVersion).toBe(2);
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
      const { overall_score, ...withoutOverall } = validEvaluationJson;
      llmService.chat.mockResolvedValue(JSON.stringify(withoutOverall));

      await expect(service.evaluate(mockInput)).rejects.toThrow(EvaluatorError);
      await expect(service.evaluate(mockInput)).rejects.toMatchObject({ code: 'invalid_response' });
    });

    it('should throw EvaluatorError with code "invalid_response" when fluency_score is missing', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const { fluency_score, ...withoutFluency } = validEvaluationJson;
      llmService.chat.mockResolvedValue(JSON.stringify(withoutFluency));

      await expect(service.evaluate(mockInput)).rejects.toThrow(EvaluatorError);
      await expect(service.evaluate(mockInput)).rejects.toMatchObject({ code: 'invalid_response' });
    });

    it('should throw EvaluatorError with code "invalid_response" when accuracy_score is missing', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const { accuracy_score, ...withoutAccuracy } = validEvaluationJson;
      llmService.chat.mockResolvedValue(JSON.stringify(withoutAccuracy));

      await expect(service.evaluate(mockInput)).rejects.toThrow(EvaluatorError);
      await expect(service.evaluate(mockInput)).rejects.toMatchObject({ code: 'invalid_response' });
    });

    it('should throw EvaluatorError with code "invalid_response" when summary is missing', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const { summary, ...withoutSummary } = validEvaluationJson;
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
        'scenario-evaluation-prompt.md',
        expect.objectContaining({
          targetLanguage: 'French',
          nativeLanguage: 'English',
          proficiencyLevel: 'intermediate',
          scenarioTitle: 'Restaurant Ordering',
          scenarioDescription: 'Learn to order food at a restaurant',
          transcript: expect.stringContaining('User:'),
        }),
      );
    });

    it('should not pass vocab-related fields to the prompt loader', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      llmService.chat.mockResolvedValue(JSON.stringify(validEvaluationJson));

      await service.evaluate(mockInput);

      const callArgs = promptLoader.loadPrompt.mock.calls[0][1];
      expect(callArgs).not.toHaveProperty('injectedVocab');
      expect(callArgs).not.toHaveProperty('vocabUsageHits');
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
        expect.objectContaining({ scenarioDescription: '' }),
      );
    });

    it('should use placeholder when transcript is empty', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      llmService.chat.mockResolvedValue(JSON.stringify({
        ...validEvaluationJson,
        overall_score: 0,
        fluency_score: 0,
        accuracy_score: 0,
        strengths: [],
        improvements: [],
        summary: 'No session',
      }));

      await service.evaluate({ ...mockInput, messages: [] });

      expect(promptLoader.loadPrompt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ transcript: '(no messages)' }),
      );
    });
  });

  describe('evaluate - response building', () => {
    it('should return empty arrays for strengths and improvements if not provided by LLM', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const minimalEval = {
        overall_score: 75,
        fluency_score: 75,
        accuracy_score: 75,
        summary: 'OK',
      };
      llmService.chat.mockResolvedValue(JSON.stringify(minimalEval));

      const result = await service.evaluate(mockInput);

      expect(result.strengths).toEqual([]);
      expect(result.improvements).toEqual([]);
    });

    it('should return empty string for summary if it is non-string', async () => {
      promptLoader.loadPrompt.mockReturnValue('prompt');
      const badSummary = { ...validEvaluationJson, summary: 123 };
      llmService.chat.mockResolvedValue(JSON.stringify(badSummary));

      const result = await service.evaluate(mockInput);

      expect(result.summary).toBe('');
    });
  });
});

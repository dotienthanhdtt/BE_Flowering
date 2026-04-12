// Mock ESM-dependent modules to prevent dynamic import errors in LLM providers
jest.mock('../providers/openai-llm.provider', () => ({}));
jest.mock('../providers/anthropic-llm.provider', () => ({}));
jest.mock('../providers/gemini-llm.provider', () => ({}));
jest.mock('./unified-llm.service');
jest.mock('./prompt-loader.service');

import { LearningAgentService } from './learning-agent.service';
import { LLMModel } from '../providers/llm-models.enum';

describe('LearningAgentService - checkCorrection', () => {
  let service: LearningAgentService;
  let llmService: any;
  let promptLoader: any;

  beforeEach(() => {
    jest.clearAllMocks();
    llmService = { chat: jest.fn() };
    promptLoader = { loadPrompt: jest.fn().mockReturnValue('formatted prompt') };
    const conversationRepo = {} as any;
    const messageRepo = {} as any;

    service = new LearningAgentService(
      llmService, promptLoader, conversationRepo, messageRepo,
    );
  });

  it('should return null correctedText when LLM returns "null"', async () => {
    llmService.chat.mockResolvedValue('null');

    const result = await service.checkCorrection('Hi!', 'Hi!', 'en');

    expect(result.correctedText).toBeNull();
  });

  it('should return corrected text when LLM returns a correction', async () => {
    llmService.chat.mockResolvedValue('I am fine, thank you.');

    const result = await service.checkCorrection(
      'How are you?', 'I fine thank you', 'en',
    );

    expect(result.correctedText).toBe('I am fine, thank you.');
  });

  it('should handle "null" with surrounding whitespace', async () => {
    llmService.chat.mockResolvedValue('  null  ');

    const result = await service.checkCorrection('Hi', 'Hi', 'en');

    expect(result.correctedText).toBeNull();
  });

  it('should handle "null" with surrounding quotes', async () => {
    llmService.chat.mockResolvedValue('"null"');

    const result = await service.checkCorrection('Hi', 'Hi', 'en');

    expect(result.correctedText).toBeNull();
  });

  it('should strip surrounding quotes from corrected text', async () => {
    llmService.chat.mockResolvedValue('"I am fine."');

    const result = await service.checkCorrection('How?', 'I fine', 'en');

    expect(result.correctedText).toBe('I am fine.');
  });

  it('should pass correct prompt template variables', async () => {
    llmService.chat.mockResolvedValue('null');

    await service.checkCorrection('AI msg', 'User msg', 'ja');

    expect(promptLoader.loadPrompt).toHaveBeenCalledWith(
      'correction-check-prompt.json',
      { previousAiMessage: 'AI msg', userMessage: 'User msg', targetLanguage: 'ja' },
    );
  });

  it('should use Gemini Flash Lite model with temperature 0', async () => {
    llmService.chat.mockResolvedValue('null');

    await service.checkCorrection('Hi', 'Hi', 'en');

    expect(llmService.chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        model: LLMModel.GEMINI_3_1_FLASH_LITE_PREVIEW,
        temperature: 0.0,
        maxTokens: 10000,
        metadata: { feature: 'correction-check' },
      }),
    );
  });

  it('should return null for empty string response', async () => {
    llmService.chat.mockResolvedValue('');

    const result = await service.checkCorrection('Hi', 'Hi', 'en');

    expect(result.correctedText).toBeNull();
  });

  it('should handle case-insensitive "NULL" response', async () => {
    llmService.chat.mockResolvedValue('NULL');

    const result = await service.checkCorrection('Hi', 'Hi', 'en');

    expect(result.correctedText).toBeNull();
  });
});

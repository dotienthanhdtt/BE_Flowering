import { ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';
import { OpenAiSttProvider } from './openai-stt.provider';

jest.mock('openai');

describe('OpenAiSttProvider', () => {
  let provider: OpenAiSttProvider;
  let configService: any;
  let mockOpenAIClient: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup ConfigService mock
    configService = {
      get: jest.fn(),
    };

    // Setup OpenAI SDK mock
    mockOpenAIClient = {
      audio: {
        transcriptions: {
          create: jest.fn(),
        },
      },
    };

    (OpenAI as unknown as jest.Mock).mockImplementation(() => mockOpenAIClient);

    provider = new OpenAiSttProvider(configService);
  });

  describe('name property', () => {
    it('should have correct provider name', () => {
      expect(provider.name).toBe('openai-whisper');
    });
  });

  describe('isAvailable', () => {
    it('should return true when API key is configured', () => {
      configService.get.mockReturnValue('sk-test-api-key');

      const result = provider.isAvailable();

      expect(result).toBe(true);
      expect(configService.get).toHaveBeenCalledWith('ai.openaiApiKey', { infer: true });
    });

    it('should return false when API key is not configured', () => {
      configService.get.mockReturnValue(null);

      const result = provider.isAvailable();

      expect(result).toBe(false);
    });

    it('should return false when API key is empty string', () => {
      configService.get.mockReturnValue('');

      const result = provider.isAvailable();

      expect(result).toBe(false);
    });

    it('should return false when API key is undefined', () => {
      configService.get.mockReturnValue(undefined);

      const result = provider.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe('transcribe', () => {
    const audioBuffer = Buffer.from('fake audio data');
    const mimeType = 'audio/mp4';

    it('should return transcribed text on success', async () => {
      configService.get.mockReturnValue('sk-test-api-key');
      mockOpenAIClient.audio.transcriptions.create.mockResolvedValue({
        text: 'Hello world, how are you?',
      });

      const result = await provider.transcribe(audioBuffer, mimeType);

      expect(result.text).toBe('Hello world, how are you?');
      expect(mockOpenAIClient.audio.transcriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'whisper-1',
          file: expect.any(File),
        }),
      );
    });

    it('should include language option when provided', async () => {
      configService.get.mockReturnValue('sk-test-api-key');
      mockOpenAIClient.audio.transcriptions.create.mockResolvedValue({
        text: 'Hola mundo',
      });

      await provider.transcribe(audioBuffer, mimeType, { language: 'es' });

      expect(mockOpenAIClient.audio.transcriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'whisper-1',
          language: 'es',
          file: expect.any(File),
        }),
      );
    });

    it('should not include language option when not provided', async () => {
      configService.get.mockReturnValue('sk-test-api-key');
      mockOpenAIClient.audio.transcriptions.create.mockResolvedValue({
        text: 'Hello world',
      });

      await provider.transcribe(audioBuffer, mimeType);

      const callArgs = mockOpenAIClient.audio.transcriptions.create.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('language');
    });

    it('should throw ServiceUnavailableException when API key is not configured', async () => {
      configService.get.mockReturnValue(null);

      await expect(provider.transcribe(audioBuffer, mimeType)).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(provider.transcribe(audioBuffer, mimeType)).rejects.toThrow(
        'OpenAI API key not configured',
      );
    });

    it('should throw ServiceUnavailableException when OpenAI API call fails', async () => {
      configService.get.mockReturnValue('sk-test-api-key');
      const apiError = new Error('API rate limit exceeded');
      mockOpenAIClient.audio.transcriptions.create.mockRejectedValue(apiError);

      await expect(provider.transcribe(audioBuffer, mimeType)).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(provider.transcribe(audioBuffer, mimeType)).rejects.toThrow(
        'Transcription service temporarily unavailable',
      );
    });

    it('should throw ServiceUnavailableException when OpenAI returns invalid response', async () => {
      configService.get.mockReturnValue('sk-test-api-key');
      mockOpenAIClient.audio.transcriptions.create.mockRejectedValue(
        new Error('Invalid response format'),
      );

      await expect(provider.transcribe(audioBuffer, mimeType)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should handle empty audio buffer', async () => {
      configService.get.mockReturnValue('sk-test-api-key');
      mockOpenAIClient.audio.transcriptions.create.mockResolvedValue({
        text: '',
      });

      const result = await provider.transcribe(Buffer.alloc(0), mimeType);

      expect(result.text).toBe('');
    });

    it('should handle different audio MIME types', async () => {
      configService.get.mockReturnValue('sk-test-api-key');
      mockOpenAIClient.audio.transcriptions.create.mockResolvedValue({
        text: 'Transcribed text',
      });

      const mimeTypes = ['audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/m4a'];

      for (const mime of mimeTypes) {
        await provider.transcribe(audioBuffer, mime);
      }

      expect(mockOpenAIClient.audio.transcriptions.create).toHaveBeenCalledTimes(4);
    });

    it('should create File with correct MIME type', async () => {
      configService.get.mockReturnValue('sk-test-api-key');
      mockOpenAIClient.audio.transcriptions.create.mockResolvedValue({
        text: 'Test',
      });

      await provider.transcribe(audioBuffer, 'audio/wav');

      const callArgs = mockOpenAIClient.audio.transcriptions.create.mock.calls[0][0];
      expect(callArgs.file.type).toBe('audio/wav');
    });
  });
});

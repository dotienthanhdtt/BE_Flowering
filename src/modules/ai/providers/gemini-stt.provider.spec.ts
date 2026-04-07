import { ServiceUnavailableException } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GeminiSttProvider } from './gemini-stt.provider';

jest.mock('@google/generative-ai');

describe('GeminiSttProvider', () => {
  let provider: GeminiSttProvider;
  let configService: any;
  let mockGenerativeAI: any;
  let mockModel: any;
  let mockResponse: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup ConfigService mock
    configService = {
      get: jest.fn(),
    };

    // Setup Google GenerativeAI SDK mock
    mockResponse = {
      response: {
        text: jest.fn(),
      },
    };

    mockModel = {
      generateContent: jest.fn().mockResolvedValue(mockResponse),
    };

    mockGenerativeAI = {
      getGenerativeModel: jest.fn().mockReturnValue(mockModel),
    };

    (GoogleGenerativeAI as unknown as jest.Mock).mockImplementation(() => mockGenerativeAI);

    provider = new GeminiSttProvider(configService);
  });

  describe('name property', () => {
    it('should have correct provider name', () => {
      expect(provider.name).toBe('gemini-multimodal');
    });
  });

  describe('isAvailable', () => {
    it('should return true when API key is configured', () => {
      configService.get.mockReturnValue('AIzaSyD-test-key');

      const result = provider.isAvailable();

      expect(result).toBe(true);
      expect(configService.get).toHaveBeenCalledWith('ai.googleAiApiKey', { infer: true });
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
      configService.get.mockReturnValue('AIzaSyD-test-key');
      mockResponse.response.text.mockReturnValue('Hello world, how are you?');

      const result = await provider.transcribe(audioBuffer, mimeType);

      expect(result.text).toBe('Hello world, how are you?');
      expect(mockModel.generateContent).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            inlineData: expect.objectContaining({
              mimeType: 'audio/mp4',
              data: audioBuffer.toString('base64'),
            }),
          }),
          expect.stringContaining('Transcribe this audio accurately'),
        ]),
      );
    });

    it('should include language hint when language option is provided', async () => {
      configService.get.mockReturnValue('AIzaSyD-test-key');
      mockResponse.response.text.mockReturnValue('Hola mundo');

      await provider.transcribe(audioBuffer, mimeType, { language: 'es' });

      const callArgs = mockModel.generateContent.mock.calls[0][0];
      expect(callArgs[1]).toContain('The audio is in es.');
    });

    it('should not include language hint when language option is not provided', async () => {
      configService.get.mockReturnValue('AIzaSyD-test-key');
      mockResponse.response.text.mockReturnValue('Hello world');

      await provider.transcribe(audioBuffer, mimeType);

      const callArgs = mockModel.generateContent.mock.calls[0][0];
      expect(callArgs[1]).not.toContain('The audio is in');
    });

    it('should trim whitespace from transcribed text', async () => {
      configService.get.mockReturnValue('AIzaSyD-test-key');
      mockResponse.response.text.mockReturnValue('  Hello world  \n');

      const result = await provider.transcribe(audioBuffer, mimeType);

      expect(result.text).toBe('Hello world');
    });

    it('should throw ServiceUnavailableException when API key is not configured', async () => {
      configService.get.mockReturnValue(null);

      await expect(provider.transcribe(audioBuffer, mimeType)).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(provider.transcribe(audioBuffer, mimeType)).rejects.toThrow(
        'Google AI API key not configured',
      );
    });

    it('should throw ServiceUnavailableException when Gemini API call fails', async () => {
      configService.get.mockReturnValue('AIzaSyD-test-key');
      const apiError = new Error('API quota exceeded');
      mockModel.generateContent.mockRejectedValue(apiError);

      await expect(provider.transcribe(audioBuffer, mimeType)).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(provider.transcribe(audioBuffer, mimeType)).rejects.toThrow(
        'Transcription service temporarily unavailable',
      );
    });

    it('should throw ServiceUnavailableException when response.text() fails', async () => {
      configService.get.mockReturnValue('AIzaSyD-test-key');
      mockResponse.response.text.mockImplementation(() => {
        throw new Error('Invalid response');
      });

      await expect(provider.transcribe(audioBuffer, mimeType)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should handle empty audio buffer', async () => {
      configService.get.mockReturnValue('AIzaSyD-test-key');
      mockResponse.response.text.mockReturnValue('');

      const result = await provider.transcribe(Buffer.alloc(0), mimeType);

      expect(result.text).toBe('');
    });

    it('should handle different audio MIME types', async () => {
      configService.get.mockReturnValue('AIzaSyD-test-key');
      mockResponse.response.text.mockReturnValue('Transcribed');

      const mimeTypes = ['audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/m4a', 'audio/x-m4a'];

      for (const mime of mimeTypes) {
        await provider.transcribe(audioBuffer, mime);
      }

      expect(mockModel.generateContent).toHaveBeenCalledTimes(5);

      // Verify each call had the correct MIME type
      const calls = mockModel.generateContent.mock.calls;
      for (let i = 0; i < mimeTypes.length; i++) {
        expect(calls[i][0][0].inlineData.mimeType).toBe(mimeTypes[i]);
      }
    });

    it('should properly encode audio buffer to base64', async () => {
      configService.get.mockReturnValue('AIzaSyD-test-key');
      mockResponse.response.text.mockReturnValue('Test');

      const testBuffer = Buffer.from('test data');
      const expectedBase64 = testBuffer.toString('base64');

      await provider.transcribe(testBuffer, mimeType);

      const callArgs = mockModel.generateContent.mock.calls[0][0];
      expect(callArgs[0].inlineData.data).toBe(expectedBase64);
    });

    it('should initialize GoogleGenerativeAI with correct API key', async () => {
      const testKey = 'AIzaSyD-test-key-123';
      configService.get.mockReturnValue(testKey);
      mockResponse.response.text.mockReturnValue('Test');

      await provider.transcribe(audioBuffer, mimeType);

      expect(GoogleGenerativeAI as unknown as jest.Mock).toHaveBeenCalledWith(testKey);
    });

    it('should use gemini-2.0-flash model', async () => {
      configService.get.mockReturnValue('AIzaSyD-test-key');
      mockResponse.response.text.mockReturnValue('Test');

      await provider.transcribe(audioBuffer, mimeType);

      expect(mockGenerativeAI.getGenerativeModel).toHaveBeenCalledWith({
        model: 'gemini-2.0-flash',
      });
    });

    it('should handle multiple transcription requests sequentially', async () => {
      configService.get.mockReturnValue('AIzaSyD-test-key');
      mockResponse.response.text.mockReturnValue('Transcribed');

      const buffer1 = Buffer.from('audio1');
      const buffer2 = Buffer.from('audio2');

      const result1 = await provider.transcribe(buffer1, 'audio/mp4');
      const result2 = await provider.transcribe(buffer2, 'audio/wav');

      expect(result1.text).toBe('Transcribed');
      expect(result2.text).toBe('Transcribed');
      expect(mockModel.generateContent).toHaveBeenCalledTimes(2);
    });

    it('should handle very long audio transcriptions', async () => {
      configService.get.mockReturnValue('AIzaSyD-test-key');
      const longText =
        'This is a very long transcription. '.repeat(100); // ~3600 characters
      mockResponse.response.text.mockReturnValue(longText);

      const result = await provider.transcribe(audioBuffer, mimeType);

      // Provider calls .trim() on the response
      expect(result.text).toBe(longText.trim());
    });
  });
});

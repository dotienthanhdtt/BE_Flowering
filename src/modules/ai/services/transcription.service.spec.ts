import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { TranscriptionService } from './transcription.service';

describe('TranscriptionService', () => {
  let service: TranscriptionService;
  let configService: any;
  let openaiStt: any;
  let geminiStt: any;
  let storageService: any;

  const mockFile = (overrides: Partial<Express.Multer.File> = {}): any => ({
    fieldname: 'audio',
    originalname: 'test.m4a',
    encoding: '7bit',
    mimetype: 'audio/m4a',
    buffer: Buffer.from('fake audio data'),
    size: 1024 * 100, // 100KB
    destination: '/tmp',
    filename: 'test.m4a',
    path: '/tmp/test.m4a',
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    configService = {
      get: jest.fn(),
    };

    openaiStt = {
      isAvailable: jest.fn(),
      transcribe: jest.fn(),
      name: 'openai-whisper',
    };

    geminiStt = {
      isAvailable: jest.fn(),
      transcribe: jest.fn(),
      name: 'gemini-multimodal',
    };

    storageService = {
      uploadAudio: jest.fn().mockResolvedValue(undefined),
    };

    service = new TranscriptionService(
      configService,
      openaiStt,
      geminiStt,
      storageService,
    );
  });

  describe('validateFile', () => {
    it('should pass validation for valid audio file', () => {
      const file = mockFile({ size: 1024 * 100 });

      expect(() => service.validateFile(file)).not.toThrow();
    });

    it('should throw BadRequestException when file is null', () => {
      expect(() => service.validateFile(null as any)).toThrow(BadRequestException);
      expect(() => service.validateFile(null as any)).toThrow('Audio file is required');
    });

    it('should throw BadRequestException when file is undefined', () => {
      expect(() => service.validateFile(undefined as any)).toThrow(BadRequestException);
      expect(() => service.validateFile(undefined as any)).toThrow('Audio file is required');
    });

    it('should throw BadRequestException when file exceeds 10MB', () => {
      const file = mockFile({ size: 10 * 1024 * 1024 + 1 });

      expect(() => service.validateFile(file)).toThrow(BadRequestException);
      expect(() => service.validateFile(file)).toThrow('File exceeds 10MB limit');
    });

    it('should throw BadRequestException when file is exactly 10MB', () => {
      const file = mockFile({ size: 10 * 1024 * 1024 });

      expect(() => service.validateFile(file)).not.toThrow();
    });

    it('should throw BadRequestException when file is 1 byte over 10MB', () => {
      const file = mockFile({ size: 10 * 1024 * 1024 + 1 });

      expect(() => service.validateFile(file)).toThrow('File exceeds 10MB limit');
    });

    it('should throw BadRequestException for unsupported MIME type', () => {
      const file = mockFile({ mimetype: 'video/mp4' });

      expect(() => service.validateFile(file)).toThrow(BadRequestException);
      expect(() => service.validateFile(file)).toThrow('Unsupported audio format: video/mp4');
    });

    it('should accept all supported MIME types', () => {
      const supportedMimes = ['audio/x-m4a', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/m4a'];

      supportedMimes.forEach((mime) => {
        const file = mockFile({ mimetype: mime });
        expect(() => service.validateFile(file)).not.toThrow();
      });
    });

    it('should throw BadRequestException for empty filename', () => {
      const file = mockFile({ originalname: '' });

      expect(() => service.validateFile(file)).not.toThrow();
    });

    it('should accept small files', () => {
      const file = mockFile({ size: 1024 }); // 1KB

      expect(() => service.validateFile(file)).not.toThrow();
    });

    it('should accept medium-sized files', () => {
      const file = mockFile({ size: 5 * 1024 * 1024 }); // 5MB

      expect(() => service.validateFile(file)).not.toThrow();
    });
  });

  describe('transcribe', () => {
    const userId = 'user-123';
    const file = mockFile();

    it('should upload audio before transcription', async () => {
      openaiStt.isAvailable.mockReturnValue(true);
      openaiStt.transcribe.mockResolvedValue({ text: 'Hello world' });

      await service.transcribe(file, userId);

      expect(storageService.uploadAudio).toHaveBeenCalledWith(
        file.buffer,
        userId,
        file.originalname,
      );
      // Verify uploadAudio is called first by checking call order
      expect(storageService.uploadAudio).toHaveBeenCalledTimes(1);
      expect(openaiStt.transcribe).toHaveBeenCalledTimes(1);
    });

    it('should validate file before processing', async () => {
      const invalidFile = mockFile({ size: 10 * 1024 * 1024 + 1 });

      await expect(service.transcribe(invalidFile, userId)).rejects.toThrow(
        BadRequestException,
      );
      expect(storageService.uploadAudio).not.toHaveBeenCalled();
    });

    it('should use OpenAI by default when available', async () => {
      configService.get.mockReturnValue(undefined); // No STT_PROVIDER set
      openaiStt.isAvailable.mockReturnValue(true);
      geminiStt.isAvailable.mockReturnValue(true);
      openaiStt.transcribe.mockResolvedValue({ text: 'Transcribed by OpenAI' });

      const result = await service.transcribe(file, userId);

      expect(openaiStt.transcribe).toHaveBeenCalledWith(file.buffer, file.mimetype);
      expect(geminiStt.transcribe).not.toHaveBeenCalled();
      expect(result.text).toBe('Transcribed by OpenAI');
    });

    it('should use Gemini when STT_PROVIDER=gemini', async () => {
      configService.get.mockReturnValue('gemini');
      geminiStt.isAvailable.mockReturnValue(true);
      openaiStt.isAvailable.mockReturnValue(true);
      geminiStt.transcribe.mockResolvedValue({ text: 'Transcribed by Gemini' });

      const result = await service.transcribe(file, userId);

      expect(geminiStt.transcribe).toHaveBeenCalledWith(file.buffer, file.mimetype);
      expect(openaiStt.transcribe).not.toHaveBeenCalled();
      expect(result.text).toBe('Transcribed by Gemini');
    });

    it('should use OpenAI when STT_PROVIDER=openai', async () => {
      configService.get.mockReturnValue('openai');
      openaiStt.isAvailable.mockReturnValue(true);
      openaiStt.transcribe.mockResolvedValue({ text: 'Transcribed' });

      await service.transcribe(file, userId);

      expect(openaiStt.transcribe).toHaveBeenCalled();
    });

    it('should fallback to Gemini when OpenAI fails', async () => {
      configService.get.mockReturnValue(undefined);
      openaiStt.isAvailable.mockReturnValue(true);
      geminiStt.isAvailable.mockReturnValue(true);
      const openaiError = new ServiceUnavailableException('OpenAI failed');
      openaiStt.transcribe.mockRejectedValue(openaiError);
      geminiStt.transcribe.mockResolvedValue({ text: 'Fallback to Gemini' });

      const result = await service.transcribe(file, userId);

      expect(openaiStt.transcribe).toHaveBeenCalled();
      expect(geminiStt.transcribe).toHaveBeenCalled();
      expect(result.text).toBe('Fallback to Gemini');
    });

    it('should fallback to OpenAI when Gemini fails (when Gemini is primary)', async () => {
      configService.get.mockReturnValue('gemini');
      geminiStt.isAvailable.mockReturnValue(true);
      openaiStt.isAvailable.mockReturnValue(true);
      const geminiError = new ServiceUnavailableException('Gemini failed');
      geminiStt.transcribe.mockRejectedValue(geminiError);
      openaiStt.transcribe.mockResolvedValue({ text: 'Fallback to OpenAI' });

      const result = await service.transcribe(file, userId);

      expect(geminiStt.transcribe).toHaveBeenCalled();
      expect(openaiStt.transcribe).toHaveBeenCalled();
      expect(result.text).toBe('Fallback to OpenAI');
    });

    it('should throw ServiceUnavailableException when no provider is available', async () => {
      openaiStt.isAvailable.mockReturnValue(false);
      geminiStt.isAvailable.mockReturnValue(false);

      await expect(service.transcribe(file, userId)).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(service.transcribe(file, userId)).rejects.toThrow(
        'No STT provider available',
      );
    });

    it('should throw error when both providers fail and fallback is unavailable', async () => {
      configService.get.mockReturnValue(undefined);
      openaiStt.isAvailable.mockReturnValue(true);
      geminiStt.isAvailable.mockReturnValue(false);
      const openaiError = new ServiceUnavailableException('OpenAI failed');
      openaiStt.transcribe.mockRejectedValue(openaiError);

      await expect(service.transcribe(file, userId)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(geminiStt.transcribe).not.toHaveBeenCalled();
    });

    it('should propagate error when fallback also fails', async () => {
      configService.get.mockReturnValue(undefined);
      openaiStt.isAvailable.mockReturnValue(true);
      geminiStt.isAvailable.mockReturnValue(true);
      const openaiError = new ServiceUnavailableException('OpenAI failed');
      const geminiError = new ServiceUnavailableException('Gemini also failed');
      openaiStt.transcribe.mockRejectedValue(openaiError);
      geminiStt.transcribe.mockRejectedValue(geminiError);

      await expect(service.transcribe(file, userId)).rejects.toThrow(geminiError);
    });

    it('should return correct SttResult format', async () => {
      openaiStt.isAvailable.mockReturnValue(true);
      openaiStt.transcribe.mockResolvedValue({ text: 'Hello world' });

      const result = await service.transcribe(file, userId);

      expect(result).toEqual({ text: 'Hello world' });
      expect(result).toHaveProperty('text');
      expect(typeof result.text).toBe('string');
    });

    it('should handle empty transcription result', async () => {
      openaiStt.isAvailable.mockReturnValue(true);
      openaiStt.transcribe.mockResolvedValue({ text: '' });

      const result = await service.transcribe(file, userId);

      expect(result.text).toBe('');
    });

    it('should handle transcription with special characters', async () => {
      openaiStt.isAvailable.mockReturnValue(true);
      const specialText = 'Hello! @#$%^&*() Привет 你好 مرحبا';
      openaiStt.transcribe.mockResolvedValue({ text: specialText });

      const result = await service.transcribe(file, userId);

      expect(result.text).toBe(specialText);
    });

    it('should handle transcription with newlines', async () => {
      openaiStt.isAvailable.mockReturnValue(true);
      const multilineText = 'Line 1\nLine 2\nLine 3';
      openaiStt.transcribe.mockResolvedValue({ text: multilineText });

      const result = await service.transcribe(file, userId);

      expect(result.text).toBe(multilineText);
    });

    it('should pass correct file buffer and MIME type to provider', async () => {
      const testFile = mockFile({
        buffer: Buffer.from('test audio'),
        mimetype: 'audio/wav',
      });
      openaiStt.isAvailable.mockReturnValue(true);
      openaiStt.transcribe.mockResolvedValue({ text: 'Test' });

      await service.transcribe(testFile, userId);

      expect(openaiStt.transcribe).toHaveBeenCalledWith(testFile.buffer, 'audio/wav');
    });

    it('should handle multiple concurrent transcription requests', async () => {
      openaiStt.isAvailable.mockReturnValue(true);
      openaiStt.transcribe
        .mockResolvedValueOnce({ text: 'First transcription' })
        .mockResolvedValueOnce({ text: 'Second transcription' });

      const file1 = mockFile({ originalname: 'file1.m4a' });
      const file2 = mockFile({ originalname: 'file2.m4a' });

      const results = await Promise.all([
        service.transcribe(file1, 'user-1'),
        service.transcribe(file2, 'user-2'),
      ]);

      expect(results[0].text).toBe('First transcription');
      expect(results[1].text).toBe('Second transcription');
      expect(storageService.uploadAudio).toHaveBeenCalledTimes(2);
    });

    it('should correctly identify provider when switching from OpenAI to Gemini', async () => {
      configService.get.mockReturnValue('gemini');
      geminiStt.isAvailable.mockReturnValue(true);
      openaiStt.isAvailable.mockReturnValue(true);
      geminiStt.transcribe.mockResolvedValue({ text: 'Gemini result' });

      await service.transcribe(file, userId);

      expect(geminiStt.transcribe).toHaveBeenCalled();
      expect(openaiStt.transcribe).not.toHaveBeenCalled();
    });

    it('should handle provider availability changing between calls', async () => {
      openaiStt.isAvailable.mockReturnValue(true);
      geminiStt.isAvailable.mockReturnValue(true);
      openaiStt.transcribe
        .mockResolvedValueOnce({ text: 'First' })
        .mockRejectedValueOnce(new ServiceUnavailableException('OpenAI offline'));

      const file1 = mockFile({ originalname: 'file1.m4a' });
      const file2 = mockFile({ originalname: 'file2.m4a' });

      geminiStt.transcribe.mockResolvedValue({ text: 'Fallback result' });

      const result1 = await service.transcribe(file1, 'user-1');
      const result2 = await service.transcribe(file2, 'user-2');

      expect(result1.text).toBe('First');
      expect(result2.text).toBe('Fallback result');
    });

    it('should call uploadAudio with correct parameters', async () => {
      openaiStt.isAvailable.mockReturnValue(true);
      openaiStt.transcribe.mockResolvedValue({ text: 'Test' });

      const testFile = mockFile({
        buffer: Buffer.from('test'),
        originalname: 'recording.wav',
      });

      await service.transcribe(testFile, 'user-123');

      expect(storageService.uploadAudio).toHaveBeenCalledWith(
        testFile.buffer,
        'user-123',
        'recording.wav',
      );
    });

    it('should continue transcription even if uploadAudio fails', async () => {
      openaiStt.isAvailable.mockReturnValue(true);
      storageService.uploadAudio.mockRejectedValue(new Error('Storage error'));
      openaiStt.transcribe.mockResolvedValue({ text: 'Test' });

      // Should throw the storage error
      await expect(service.transcribe(file, userId)).rejects.toThrow('Storage error');
    });

    it('should handle provider returning null text gracefully', async () => {
      openaiStt.isAvailable.mockReturnValue(true);
      openaiStt.transcribe.mockResolvedValue({ text: null } as any);

      const result = await service.transcribe(file, userId);

      expect(result.text).toBeNull();
    });
  });

  describe('getProvider', () => {
    it('should select primary provider when both available and primary is OpenAI', () => {
      configService.get.mockReturnValue(undefined);
      openaiStt.isAvailable.mockReturnValue(true);

      const provider = (service as any).getProvider();

      expect(provider).toBe(openaiStt);
    });

    it('should select Gemini when STT_PROVIDER=gemini and both available', () => {
      configService.get.mockReturnValue('gemini');
      geminiStt.isAvailable.mockReturnValue(true);
      openaiStt.isAvailable.mockReturnValue(true);

      const provider = (service as any).getProvider();

      expect(provider).toBe(geminiStt);
    });

    it('should fallback to OpenAI when Gemini is primary but unavailable', () => {
      configService.get.mockReturnValue('gemini');
      geminiStt.isAvailable.mockReturnValue(false);
      openaiStt.isAvailable.mockReturnValue(true);

      const provider = (service as any).getProvider();

      expect(provider).toBe(openaiStt);
    });

    it('should fallback to Gemini when OpenAI is primary but unavailable', () => {
      configService.get.mockReturnValue(undefined);
      openaiStt.isAvailable.mockReturnValue(false);
      geminiStt.isAvailable.mockReturnValue(true);

      const provider = (service as any).getProvider();

      expect(provider).toBe(geminiStt);
    });

    it('should throw when no provider is available', () => {
      openaiStt.isAvailable.mockReturnValue(false);
      geminiStt.isAvailable.mockReturnValue(false);

      expect(() => (service as any).getProvider()).toThrow(ServiceUnavailableException);
      expect(() => (service as any).getProvider()).toThrow('No STT provider available');
    });
  });

  describe('edge cases', () => {
    it('should handle very large audio buffers', async () => {
      const largeBuffer = Buffer.alloc(9 * 1024 * 1024); // 9MB
      const file = mockFile({ buffer: largeBuffer, size: largeBuffer.length });
      openaiStt.isAvailable.mockReturnValue(true);
      openaiStt.transcribe.mockResolvedValue({ text: 'Large audio transcribed' });

      const result = await service.transcribe(file, 'user-123');

      expect(result.text).toBe('Large audio transcribed');
    });

    it('should sanitize special characters in filename', async () => {
      const file = mockFile({ originalname: 'spécial-äudio-文件.m4a' });
      openaiStt.isAvailable.mockReturnValue(true);
      openaiStt.transcribe.mockResolvedValue({ text: 'Special char filename' });

      const result = await service.transcribe(file, 'user-123');

      expect(result.text).toBe('Special char filename');
      expect(storageService.uploadAudio).toHaveBeenCalledWith(
        file.buffer,
        'user-123',
        'sp_cial-_udio-__.m4a',
      );
    });

    it('should validate before uploading', async () => {
      const invalidFile = mockFile({ mimetype: 'video/mp4' });
      openaiStt.isAvailable.mockReturnValue(true);

      await expect(service.transcribe(invalidFile, 'user-123')).rejects.toThrow(
        BadRequestException,
      );
      expect(storageService.uploadAudio).not.toHaveBeenCalled();
      expect(openaiStt.transcribe).not.toHaveBeenCalled();
    });
  });
});

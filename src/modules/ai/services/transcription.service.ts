import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiSttProvider } from '../providers/openai-stt.provider';
import { GeminiSttProvider } from '../providers/gemini-stt.provider';
import { SttProvider, SttResult } from '../providers/stt-provider.interface';
import { SupabaseStorageService } from '../../../database/supabase-storage.service';
import { AppConfiguration } from '@config/app-configuration';

@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  private readonly maxFileSize = 10 * 1024 * 1024; // 10MB
  private readonly allowedMimeTypes = [
    'audio/x-m4a',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav',
    'audio/m4a',
  ];

  constructor(
    private configService: ConfigService<AppConfiguration>,
    private openaiStt: OpenAiSttProvider,
    private geminiStt: GeminiSttProvider,
    private storageService: SupabaseStorageService,
  ) {}

  private getProvider(): SttProvider {
    const preferred = this.configService.get('ai.sttProvider', { infer: true });
    const primary = preferred === 'gemini' ? this.geminiStt : this.openaiStt;
    if (primary.isAvailable()) return primary;

    const fallback = preferred === 'gemini' ? this.openaiStt : this.geminiStt;
    if (fallback.isAvailable()) return fallback;

    throw new ServiceUnavailableException('No STT provider available');
  }

  validateFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('Audio file is required');
    }
    if (file.size > this.maxFileSize) {
      throw new BadRequestException('File exceeds 10MB limit');
    }
    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(`Unsupported audio format: ${file.mimetype}`);
    }
  }

  async transcribe(file: Express.Multer.File, userId: string): Promise<SttResult> {
    this.validateFile(file);

    // Sanitize filename to prevent path traversal, then persist
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    await this.storageService.uploadAudio(file.buffer, userId, safeName);

    const provider = this.getProvider();
    this.logger.log(`Transcribing with ${provider.name} for user ${userId}`);

    try {
      return await provider.transcribe(file.buffer, file.mimetype);
    } catch (error) {
      // Try fallback if primary fails
      const fallback = provider === this.openaiStt ? this.geminiStt : this.openaiStt;
      if (fallback.isAvailable()) {
        this.logger.warn(`${provider.name} failed, falling back to ${fallback.name}`);
        return await fallback.transcribe(file.buffer, file.mimetype);
      }
      throw error;
    }
  }
}

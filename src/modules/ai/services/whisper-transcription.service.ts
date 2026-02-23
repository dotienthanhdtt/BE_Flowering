import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';
import { AppConfiguration } from '../../../config/app-configuration';

/**
 * Service for transcribing audio using OpenAI Whisper API.
 * Used for pronunciation assessment feature.
 */
@Injectable()
export class WhisperTranscriptionService {
  private readonly logger = new Logger(WhisperTranscriptionService.name);
  private openai: OpenAI;

  constructor(configService: ConfigService<AppConfiguration>) {
    this.openai = new OpenAI({
      apiKey: configService.get('ai.openaiApiKey', { infer: true }),
    });
  }

  /**
   * Transcribe audio buffer to text using Whisper.
   * @param audioBuffer - The audio file as a Buffer
   * @param language - Optional ISO 639-1 language code (e.g., 'en', 'ja', 'vi')
   * @returns Transcribed text
   */
  async transcribe(audioBuffer: Buffer, language?: string): Promise<string> {
    try {
      // Convert buffer to file-like object for the API
      const file = await toFile(audioBuffer, 'audio.webm', { type: 'audio/webm' });

      const response = await this.openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        language,
      });

      return response.text;
    } catch (error) {
      this.logger.error('Whisper transcription failed', error);
      throw error;
    }
  }
}

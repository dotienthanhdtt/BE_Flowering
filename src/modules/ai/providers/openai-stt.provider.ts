import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { SttProvider, SttResult, SttOptions } from './stt-provider.interface';
import { AppConfiguration } from '@config/app-configuration';

@Injectable()
export class OpenAiSttProvider implements SttProvider {
  readonly name = 'openai-whisper';
  private readonly logger = new Logger(OpenAiSttProvider.name);

  constructor(private configService: ConfigService<AppConfiguration>) {}

  isAvailable(): boolean {
    return !!this.configService.get('ai.openaiApiKey', { infer: true });
  }

  async transcribe(audio: Buffer, mimeType: string, options?: SttOptions): Promise<SttResult> {
    const apiKey = this.configService.get('ai.openaiApiKey', { infer: true });
    if (!apiKey) {
      throw new ServiceUnavailableException('OpenAI API key not configured');
    }

    try {
      const client = new OpenAI({ apiKey });
      const file = new File([new Uint8Array(audio)], 'audio.m4a', { type: mimeType });
      const response = await client.audio.transcriptions.create({
        model: 'whisper-1',
        file,
        ...(options?.language && { language: options.language }),
      });
      return { text: response.text };
    } catch (error) {
      this.logger.error('OpenAI Whisper transcription failed', (error as Error)?.message);
      throw new ServiceUnavailableException('Transcription service temporarily unavailable');
    }
  }
}

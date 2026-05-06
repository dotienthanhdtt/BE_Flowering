import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { SttProvider, SttResult, SttOptions } from './stt-provider.interface';
import { AppConfiguration } from '@config/app-configuration';

@Injectable()
export class GeminiSttProvider implements SttProvider {
  readonly name = 'gemini-multimodal';
  private readonly logger = new Logger(GeminiSttProvider.name);

  constructor(private configService: ConfigService<AppConfiguration>) {}

  isAvailable(): boolean {
    return !!this.configService.get('ai.googleAiApiKey', { infer: true });
  }

  async transcribe(audio: Buffer, mimeType: string, options?: SttOptions): Promise<SttResult> {
    const apiKey = this.configService.get('ai.googleAiApiKey', { infer: true });
    if (!apiKey) {
      throw new ServiceUnavailableException('Google AI API key not configured');
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

      const languageHint = options?.language ? ` The audio is in ${options.language}.` : '';
      const result = await model.generateContent([
        { inlineData: { mimeType, data: audio.toString('base64') } },
        `Transcribe this audio accurately. Return only the transcribed text, nothing else.${languageHint}`,
      ]);

      return { text: result.response.text().trim() };
    } catch (error) {
      this.logger.error('Gemini transcription failed', (error as Error)?.message);
      throw new ServiceUnavailableException('Transcription service temporarily unavailable');
    }
  }
}

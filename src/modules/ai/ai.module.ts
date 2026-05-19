import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';

// Entities
import { AiConversation, AiConversationMessage, Vocabulary } from '../../database/entities';

// Subscription module (for RevenueCatRestClient and SubscriptionService exports)
import { SubscriptionModule } from '../subscription/subscription.module';

// Providers
import { OpenAILLMProvider } from './providers/openai-llm.provider';
import { AnthropicLLMProvider } from './providers/anthropic-llm.provider';
import { GeminiLLMProvider } from './providers/gemini-llm.provider';
import { NineRouterLLMProvider } from './providers/ninerouter-llm.provider';
import { OpenAiSttProvider } from './providers/openai-stt.provider';
import { GeminiSttProvider } from './providers/gemini-stt.provider';
import { SonioxSttProvider } from './providers/soniox-stt.provider';
import { SonioxTtsProvider } from './providers/soniox-tts.provider';
import { AlibabaTtsProvider } from './providers/alibaba-tts.provider';
import { FallbackTtsProvider } from './providers/fallback-tts.provider';

// Services
import { LangfuseService } from './services/langfuse-tracing.service';
import { PromptLoaderService } from './services/prompt-loader.service';
import { UnifiedLLMService } from './services/unified-llm.service';
import { LearningAgentService } from './services/learning-agent.service';
import { TranslationService } from './services/translation.service';
import { TranscriptionService } from './services/transcription.service';
import { MessageCorrectionService } from './services/message-correction.service';
import { ObjectStorageService } from '../../database/object-storage.service';
import { IntakeChatEngine } from './services/intake-chat-engine.service';

// Speech
import { SpeechGateway } from './speech/speech.gateway';
import { SpeechService } from './speech/speech.service';
import { WsAuthGuard } from './speech/ws-auth.guard';
import { TtsService } from './speech/tts.service';
import { TtsController } from './speech/tts.controller';
import { TtsGateway } from './speech/tts.gateway';

// Controller
import { AiController } from './ai.controller';

/**
 * AI Module for language learning features.
 * Provides LLM integration with OpenAI, Anthropic, and Gemini.
 * Includes rate limiting via ThrottlerModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AiConversation, AiConversationMessage, Vocabulary]),
    SubscriptionModule,
    ThrottlerModule.forRoot([
      {
        name: 'ai-short',
        ttl: 60000, // 1 minute
        limit: 20, // 20 requests per minute
      },
      {
        name: 'ai-medium',
        ttl: 3600000, // 1 hour
        limit: 100, // 100 requests per hour (free tier)
      },
    ]),
  ],
  controllers: [AiController, TtsController],
  providers: [
    // Langfuse first (dependency for providers)
    LangfuseService,
    // LLM Providers
    OpenAILLMProvider,
    AnthropicLLMProvider,
    GeminiLLMProvider,
    NineRouterLLMProvider,
    // STT Providers
    OpenAiSttProvider,
    GeminiSttProvider,
    SonioxSttProvider,
    // TTS Providers (Soniox primary, Alibaba fallback, wrapped by FallbackTtsProvider)
    SonioxTtsProvider,
    AlibabaTtsProvider,
    FallbackTtsProvider,
    // Services
    ObjectStorageService,
    PromptLoaderService,
    UnifiedLLMService,
    LearningAgentService,
    TranslationService,
    TranscriptionService,
    MessageCorrectionService,
    IntakeChatEngine,
    // Speech
    SpeechGateway,
    SpeechService,
    WsAuthGuard,
    TtsService,
    TtsGateway,
  ],
  exports: [
    UnifiedLLMService,
    LearningAgentService,
    PromptLoaderService,
    IntakeChatEngine,
    LangfuseService,
    SonioxSttProvider,
    ObjectStorageService,
  ],
})
export class AiModule {}

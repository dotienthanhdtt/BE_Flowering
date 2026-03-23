import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';

// Entities
import { AiConversation, AiConversationMessage, Vocabulary } from '../../database/entities';

// Subscription module (for PremiumGuard)
import { SubscriptionModule } from '../subscription/subscription.module';

// Providers
import { OpenAILLMProvider } from './providers/openai-llm.provider';
import { AnthropicLLMProvider } from './providers/anthropic-llm.provider';
import { GeminiLLMProvider } from './providers/gemini-llm.provider';

// Services
import { LangfuseService } from './services/langfuse-tracing.service';
import { PromptLoaderService } from './services/prompt-loader.service';
import { UnifiedLLMService } from './services/unified-llm.service';
import { WhisperTranscriptionService } from './services/whisper-transcription.service';
import { LearningAgentService } from './services/learning-agent.service';
import { TranslationService } from './services/translation.service';

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
  controllers: [AiController],
  providers: [
    // Langfuse first (dependency for providers)
    LangfuseService,
    // LLM Providers
    OpenAILLMProvider,
    AnthropicLLMProvider,
    GeminiLLMProvider,
    // Services
    PromptLoaderService,
    UnifiedLLMService,
    WhisperTranscriptionService,
    LearningAgentService,
    TranslationService,
  ],
  exports: [UnifiedLLMService, LearningAgentService, PromptLoaderService],
})
export class AiModule {}

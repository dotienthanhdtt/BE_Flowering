import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { mapGenericToFramework } from '../../common/constants/language-levels';
import { FrameworkLevelsService } from '../../common/services/framework-levels.service';
import { OnboardingScenarioDto } from './dto/onboarding-scenario.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiConversation } from '../../database/entities';
import { AiConversationType } from '../../database/entities/ai-conversation.entity';
import { Language } from '../../database/entities/language.entity';
import { IntakeChatEngine } from '../ai/services/intake-chat-engine.service';
import { onboardingConfig, onboardingEngineConfig } from './onboarding.config';
import { OnboardingChatDto, OnboardingCompleteDto } from './dto';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @InjectRepository(AiConversation)
    private conversationRepo: Repository<AiConversation>,
    @InjectRepository(Language)
    private languageRepo: Repository<Language>,
    private readonly engine: IntakeChatEngine,
    private frameworkLevels: FrameworkLevelsService,
  ) {}

  async handleChat(dto: OnboardingChatDto): Promise<{
    conversationId: string;
    reply: string;
    messageId: string;
    turnNumber: number;
    isLastTurn: boolean;
    audio_path: string | null;
    translated_content: string | null;
    corrected_content: string | null;
  }> {
    let conversationId = dto.conversationId;
    if (!conversationId) {
      if (!dto.nativeLanguage || !dto.targetLanguage) {
        throw new BadRequestException(
          'nativeLanguage and targetLanguage are required to start a new onboarding session',
        );
      }
      conversationId = (
        await this.startSession({
          nativeLanguage: dto.nativeLanguage,
          targetLanguage: dto.targetLanguage,
        })
      ).conversationId;
    }

    // Load conversation with language relation to derive prompt vars
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
      relations: ['language'],
    });
    if (!conversation) {
      throw new BadRequestException('Session not found');
    }
    const targetLanguageCode = conversation.language?.code;
    const nativeLanguage = conversation.nativeLanguage;
    if (!targetLanguageCode || !nativeLanguage) {
      throw new BadRequestException('Onboarding session is missing language data');
    }

    const result = await this.engine.runTurn(
      conversationId,
      dto.message,
      { nativeLanguage, targetLanguage: targetLanguageCode },
      onboardingEngineConfig,
      { traceId: dto.traceId, audioPath: dto.audioPath },
    );

    return { conversationId, ...result };
  }

  async complete(dto: OnboardingCompleteDto, userId: string | null = null) {
    const conversation = await this.engine.findConversation(
      dto.conversationId,
      AiConversationType.ANONYMOUS,
    );

    if (userId && !conversation.userId) {
      await this.conversationRepo.update(dto.conversationId, { userId });
      conversation.userId = userId;
      this.logger.log(`Linked onboarding conversation ${dto.conversationId} to user ${userId}`);
    }

    const language = conversation.languageId
      ? await this.languageRepo.findOne({ where: { id: conversation.languageId } })
      : null;

    // Cache hit: return previously extracted profile + scenarios
    if (
      conversation.extractedProfile &&
      Array.isArray(conversation.scenarios) &&
      conversation.scenarios.length === 5
    ) {
      const cached = conversation.extractedProfile as Record<string, unknown>;
      return {
        ...cached,
        suggestedFrameworkLevel: this.mapOnboardingLevel(
          this.frameworkLevels.getFrameworkCode(language?.id),
          cached.suggestedProficiency as string | undefined,
        ),
        scenarios: conversation.scenarios as unknown as OnboardingScenarioDto[],
      };
    }

    const { profile, generated: scenarios } = await this.engine.completeAndGenerate(
      dto.conversationId,
      onboardingEngineConfig,
      (raw) => this.parseScenarios(raw),
      async (profile, scenarios) => {
        const isProfileStructured =
          !Object.prototype.hasOwnProperty.call(profile, 'raw') && Object.keys(profile).length > 0;
        if (isProfileStructured && scenarios.length === 5) {
          await this.conversationRepo.update(dto.conversationId, {
            extractedProfile: profile as never,
            scenarios: scenarios as never,
          });
        }
      },
    );

    return {
      ...profile,
      suggestedFrameworkLevel: this.mapOnboardingLevel(
        this.frameworkLevels.getFrameworkCode(language?.id),
        profile.suggestedProficiency as string | undefined,
      ),
      scenarios,
    };
  }

  async getMessages(conversationId: string) {
    return this.engine.getMessages(
      conversationId,
      AiConversationType.ANONYMOUS,
      onboardingConfig.maxTurns,
    );
  }

  private async startSession(args: { nativeLanguage: string; targetLanguage: string }) {
    const language = await this.languageRepo.findOne({
      where: { code: args.targetLanguage, isActive: true },
    });
    if (!language) {
      throw new BadRequestException(
        `Unknown or unsupported target language: "${args.targetLanguage}"`,
      );
    }

    const conversation = this.conversationRepo.create({
      type: AiConversationType.ANONYMOUS,
      title: 'Onboarding Chat',
      languageId: language.id,
      nativeLanguage: args.nativeLanguage,
    });
    const saved = await this.conversationRepo.save(conversation);
    return { conversationId: saved.id };
  }

  private parseScenarios(response: string): OnboardingScenarioDto[] {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed) || parsed.length !== 5) {
      throw new Error(
        `Expected 5 scenarios, got ${Array.isArray(parsed) ? parsed.length : 'non-array'}`,
      );
    }

    return parsed.map((s) => ({
      title: String(s.title ?? ''),
      description: String(s.description ?? ''),
    }));
  }

  private mapOnboardingLevel(framework: string | null, suggestion: string | undefined): string {
    const generic = (suggestion ?? 'beginner').toLowerCase();
    if (!framework) return generic;
    try {
      return mapGenericToFramework(framework, generic);
    } catch {
      const lowest = this.frameworkLevels.getLevels(framework)[0]?.code ?? generic;
      this.logger.warn(
        `Invalid onboarding suggestion '${generic}' for framework ${framework}; defaulting to ${lowest}`,
      );
      return lowest;
    }
  }
}

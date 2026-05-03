import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { mapGenericToFramework } from '../../common/constants/language-levels';
import { FrameworkLevelsService } from '../../common/services/framework-levels.service';
import { OnboardingScenarioDto, SCENARIO_ACCENT_COLORS } from './dto/onboarding-scenario.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
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
  }> {
    const conversationId =
      dto.conversationId ??
      (
        await this.startSession({
          nativeLanguage: dto.nativeLanguage!,
          targetLanguage: dto.targetLanguage!,
        })
      ).conversationId;

    // Load conversation to get prompt vars from stored metadata
    const conversation = await this.conversationRepo.findOne({ where: { id: conversationId } });
    if (!conversation) {
      throw new BadRequestException('Session not found');
    }
    const meta = conversation.metadata as Record<string, string>;

    const result = await this.engine.runTurn(
      conversationId,
      dto.message,
      { nativeLanguage: meta.nativeLanguage, targetLanguage: meta.targetLanguage },
      onboardingEngineConfig,
    );

    return { conversationId, ...result };
  }

  async complete(dto: OnboardingCompleteDto) {
    const conversation = await this.engine.findConversation(
      dto.conversationId,
      AiConversationType.ANONYMOUS,
    );

    const { targetLanguage } = conversation.metadata as Record<string, string>;
    const language = await this.languageRepo.findOne({ where: { code: targetLanguage } });

    // Cache hit: return previously extracted profile + scenarios to keep UUIDs stable
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
      metadata: {
        nativeLanguage: args.nativeLanguage,
        targetLanguage: args.targetLanguage,
      },
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
      id: randomUUID(),
      title: String(s.title ?? ''),
      description: String(s.description ?? ''),
      icon: String(s.icon ?? 'star'),
      accentColor: (SCENARIO_ACCENT_COLORS.includes(s.accentColor)
        ? s.accentColor
        : 'primary') as OnboardingScenarioDto['accentColor'],
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

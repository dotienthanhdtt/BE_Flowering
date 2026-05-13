import {
  Injectable,
  ForbiddenException,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiConversation } from '@/database/entities/ai-conversation.entity';
import { MessageRole } from '@/database/entities';
import { Scenario } from '@/database/entities/scenario.entity';
import { User } from '@/database/entities/user.entity';
import {
  buildPersonalScenarioPartial,
  isValidPersonalScenarioInput,
} from '@/modules/scenario/helpers/personal-scenario-builder';
import { AiConversationType } from '@/database/entities/ai-conversation.entity';
import { IntakeChatEngine } from '@/modules/ai/services/intake-chat-engine.service';
import { LanguageService } from '@/modules/language/language.service';
import { PersonalizationQuotaService } from './personalization-quota.service';
import { PersonalizationDedupService } from './personalization-dedup.service';
import { PersonalizationPruneService } from './personalization-prune.service';
import { PersonalizeChatDto } from '../dto/personalize-chat.dto';
import { PersonalizeCompleteDto } from '../dto/personalize-complete.dto';
import { PersonalizeScenarioDto } from '../dto/personalize-scenario.dto';
import { CompleteResult } from '../types/complete-result.type';
import { LangfuseFeature } from '@/modules/ai/langfuse-feature.enum';
import type { IntakeChatEngineConfig } from '@/modules/ai/services/intake-chat-engine.types';
import { LangfuseService } from '@/modules/ai/services/langfuse-tracing.service';

const MAX_TURNS = 6;

const personalizationEngineConfig: IntakeChatEngineConfig = {
  chatPromptKey: 'personalize-chat-prompt.json',
  extractionPromptKey: 'personalize-extraction-prompt.md',
  scenariosPromptKey: 'personalize-scenarios-prompt.json',
  maxTurns: MAX_TURNS,
  conversationType: AiConversationType.PERSONALIZE_INTAKE,
  chatFeature: LangfuseFeature.PERSONALIZATION_CHAT,
  extractionFeature: LangfuseFeature.PERSONALIZATION_EXTRACTION,
  scenariosFeature: LangfuseFeature.PERSONALIZATION_SCENARIOS,
};

@Injectable()
export class PersonalizationService {
  private readonly logger = new Logger(PersonalizationService.name);

  constructor(
    @InjectRepository(AiConversation)
    private readonly conversationRepo: Repository<AiConversation>,
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly engine: IntakeChatEngine,
    private readonly languageService: LanguageService,
    private readonly quota: PersonalizationQuotaService,
    private readonly dedup: PersonalizationDedupService,
    private readonly prune: PersonalizationPruneService,
    private readonly langfuse: LangfuseService,
  ) {}

  async chat(
    userId: string,
    languageId: string,
    dto: PersonalizeChatDto,
  ): Promise<{
    conversationId: string;
    reply: string;
    messageId: string;
    turnNumber: number;
    isLastTurn: boolean;
  }> {
    const quotaDecision = await this.quota.checkQuota(userId);
    if (!quotaDecision.allowed && quotaDecision.reason === 'free_blocked') {
      throw new ForbiddenException('Personalization requires a premium subscription');
    }

    const conversationId = dto.conversationId ?? (await this.startConversation(userId, languageId));
    const langCtx = await this.loadLanguageContext(userId, languageId);

    const result = await this.engine.runTurn(
      conversationId,
      dto.message,
      {
        targetLanguage: langCtx.targetLanguage,
        nativeLanguage: langCtx.nativeLanguage,
      },
      personalizationEngineConfig,
    );

    return { conversationId, ...result };
  }

  async complete(
    userId: string,
    languageId: string,
    dto: PersonalizeCompleteDto,
  ): Promise<CompleteResult> {
    await this.assertConversationOwnership(userId, dto.conversationId);

    const quotaDecision = await this.quota.checkQuota(userId);
    if (!quotaDecision.allowed) {
      if (quotaDecision.reason === 'free_blocked') {
        throw new ForbiddenException('Personalization requires a premium subscription');
      }
      if (quotaDecision.reason === 'paywall') {
        this.langfuse.recordEvent(dto.conversationId, 'personalization.paywall', { userId });
        return { kind: 'paywall', conversationId: dto.conversationId, upsellTo: 'premium_plus' };
      }
      if (quotaDecision.reason === 'daily_ceiling') {
        this.langfuse.recordEvent(dto.conversationId, 'personalization.daily_ceiling', { userId });
        return { kind: 'daily_ceiling' };
      }
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Extract profile from conversation
    const profile = await this.engine.extractProfile(
      dto.conversationId,
      personalizationEngineConfig,
    );

    // De-dup check — if profile unchanged within 24h, return prior batch
    if (this.dedup.shouldSkipGeneration(user, profile)) {
      this.langfuse.recordEvent(dto.conversationId, 'personalization.dedup_skip', { userId });
      const recent = await this.dedup.getRecentPersonalScenarios(userId);
      return {
        kind: 'success',
        scenarios: recent.map((s) => this.toDto(s)),
        generatedNew: false,
      };
    }

    // Generate and persist scenarios
    const langCtx = await this.loadLanguageContext(userId, languageId);
    const generated = await this.engine.generateOutputs(
      { ...profile, targetLanguage: langCtx.targetLanguage },
      dto.conversationId,
      personalizationEngineConfig,
      (raw) => this.parseScenarios(raw, userId, languageId),
    );

    const saved = await this.scenarioRepo.save(generated);

    // Update user tracking fields (cast needed — TypeORM's DeepPartial doesn't accept free-form JSONB)
    await this.userRepo.update(userId, {
      lastPersonalizationAt: new Date(),
      personalizationProfileSnapshot: profile as never,
    });

    // Mark Premium monthly trial consumed if applicable
    if (quotaDecision.reason === 'ok' && quotaDecision.quotaRemaining === 1) {
      await this.quota.markPremiumTrialUsed(userId);
    }

    // Lazy prune (fire-and-forget; errors swallowed inside service)
    void this.prune.pruneIfNeeded(userId);

    this.langfuse.recordEvent(dto.conversationId, 'personalization.generated', {
      userId,
      count: saved.length,
      quotaRemaining: quotaDecision.quotaRemaining ?? -1,
    });

    return {
      kind: 'success',
      scenarios: saved.map((s) => this.toDto(s)),
      generatedNew: true,
      quotaRemaining: quotaDecision.quotaRemaining,
    };
  }

  async getMessages(
    userId: string,
    conversationId: string,
  ): Promise<{
    conversationId: string;
    turnNumber: number;
    maxTurns: number;
    isLastTurn: boolean;
    messages: Array<{ id: string; role: MessageRole; content: string; createdAt: Date }>;
  }> {
    await this.assertConversationOwnership(userId, conversationId);
    return this.engine.getMessages(
      conversationId,
      AiConversationType.PERSONALIZE_INTAKE,
      MAX_TURNS,
    );
  }

  private async startConversation(userId: string, languageId: string): Promise<string> {
    const conversation = this.conversationRepo.create({
      userId,
      languageId,
      type: AiConversationType.PERSONALIZE_INTAKE,
      title: 'Personalization Chat',
    });
    const saved = await this.conversationRepo.save(conversation);
    return saved.id;
  }

  private async assertConversationOwnership(userId: string, conversationId: string): Promise<void> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId, type: AiConversationType.PERSONALIZE_INTAKE },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.userId !== userId) throw new ForbiddenException();
  }

  private async loadLanguageContext(
    userId: string,
    languageId: string,
  ): Promise<{ targetLanguage: string; nativeLanguage: string }> {
    const [langs, nativeLang] = await Promise.all([
      this.languageService.getUserLanguages(userId),
      this.languageService.getNativeLanguage(userId),
    ]);
    const target =
      langs.find((l) => l.languageId === languageId) ??
      langs.find((l) => l.lastLearned) ??
      langs[0];
    if (!target) throw new BadRequestException('User has no active learning language');
    return {
      targetLanguage: target.language.name,
      nativeLanguage: nativeLang?.name ?? 'English',
    };
  }

  private parseScenarios(raw: string, ownerId: string, languageId: string): Partial<Scenario>[] {
    try {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();
      const parsed: Array<{ title: string; description?: string }> = JSON.parse(jsonStr);

      if (!Array.isArray(parsed) || parsed.length !== 5) {
        throw new Error(
          `Expected 5 scenarios, got ${Array.isArray(parsed) ? parsed.length : 'non-array'}`,
        );
      }

      return parsed
        .map((s) => ({
          title: String(s.title ?? ''),
          description: s.description ? String(s.description) : undefined,
          ownerId,
          languageId,
        }))
        .filter((input) => isValidPersonalScenarioInput(input))
        .map((input) => buildPersonalScenarioPartial(input));
    } catch (err) {
      this.logger.warn(`Failed to parse generated scenarios: ${(err as Error).message}`);
      return [];
    }
  }

  private toDto(s: Scenario): PersonalizeScenarioDto {
    return { id: s.id, title: s.title, description: s.description, languageId: s.languageId };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Scenario } from '@/database/entities/scenario.entity';
import { AiConversation } from '@/database/entities/ai-conversation.entity';
import {
  buildPersonalScenarioPartial,
  isValidPersonalScenarioInput,
} from '../helpers/personal-scenario-builder';

interface RawScenarioJson {
  title?: string;
  description?: string;
}

const EVENT = {
  SUCCESS: 'onboarding.materialization.success',
  SKIP_EMPTY: 'onboarding.materialization.skip.empty_json',
  SKIP_SHAPE: 'onboarding.materialization.skip.bad_shape',
  SKIP_LANG: 'onboarding.materialization.skip.no_language_id',
  SKIP_ALL_INVALID: 'onboarding.materialization.skip.all_titles_invalid',
  FAIL_DB: 'onboarding.materialization.fail.db',
} as const;

@Injectable()
export class OnboardingMaterializationService {
  private readonly logger = new Logger(OnboardingMaterializationService.name);

  constructor(@InjectRepository(Scenario) private readonly scenarioRepo: Repository<Scenario>) {}

  async materializeFromConversation(userId: string, conversation: AiConversation): Promise<void> {
    try {
      const raw = conversation.scenarios as unknown;

      if (raw === null || raw === undefined) {
        this.logger.warn({ event: EVENT.SKIP_EMPTY, userId, conversationId: conversation.id });
        return;
      }
      if (!Array.isArray(raw) || raw.length !== 5) {
        this.logger.warn({
          event: EVENT.SKIP_SHAPE,
          userId,
          conversationId: conversation.id,
          length: Array.isArray(raw) ? raw.length : null,
        });
        return;
      }
      if (!conversation.languageId) {
        this.logger.warn({ event: EVENT.SKIP_LANG, userId, conversationId: conversation.id });
        return;
      }

      const partials = (raw as RawScenarioJson[])
        .map((s, index) => ({
          title: typeof s?.title === 'string' ? s.title : '',
          description: typeof s?.description === 'string' ? s.description : undefined,
          ownerId: userId,
          languageId: conversation.languageId,
          orderIndex: index,
        }))
        .filter((input) => isValidPersonalScenarioInput(input))
        .map((input) => buildPersonalScenarioPartial(input));

      if (partials.length === 0) {
        this.logger.warn({
          event: EVENT.SKIP_ALL_INVALID,
          userId,
          conversationId: conversation.id,
        });
        return;
      }

      // orIgnore — silently drops conflicts if DB constraint violated (safety net)
      await this.scenarioRepo
        .createQueryBuilder()
        .insert()
        .into(Scenario)
        .values(partials as QueryDeepPartialEntity<Scenario>[])
        .orIgnore()
        .execute();

      this.logger.log({
        event: EVENT.SUCCESS,
        userId,
        conversationId: conversation.id,
        count: partials.length,
      });
    } catch (error) {
      this.logger.warn({
        event: EVENT.FAIL_DB,
        userId,
        conversationId: conversation.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

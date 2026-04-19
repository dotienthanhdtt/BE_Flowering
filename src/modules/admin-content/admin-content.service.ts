import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HumanMessage } from '@langchain/core/messages';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Language } from '@/database/entities/language.entity';
import { Lesson } from '@/database/entities/lesson.entity';
import { Exercise } from '@/database/entities/exercise.entity';
import { Scenario } from '@/database/entities/scenario.entity';
import { User } from '@/database/entities/user.entity';
import { ContentStatus } from '@/database/entities/content-status.enum';
import { UnifiedLLMService } from '@/modules/ai/services/unified-llm.service';
import { LLMModel } from '@/modules/ai/providers/llm-models.enum';
import { GenerateContentDto, ContentType } from './dto/generate-content.dto';
import { ListContentQueryDto } from './dto/list-content-query.dto';
import { UpdateContentDto } from './dto/update-content.dto';

type ContentRow = Lesson | Exercise | Scenario;

@Injectable()
export class AdminContentService implements OnModuleInit {
  private readonly logger = new Logger(AdminContentService.name);
  private readonly promptsDir = join(__dirname, 'prompts');

  constructor(
    @InjectRepository(Language)
    private readonly languageRepo: Repository<Language>,
    @InjectRepository(Lesson)
    private readonly lessonRepo: Repository<Lesson>,
    @InjectRepository(Exercise)
    private readonly exerciseRepo: Repository<Exercise>,
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly llm: UnifiedLLMService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    const raw = this.config.get<string>('ADMIN_EMAILS', '');
    if (!raw) {
      this.logger.warn('ADMIN_EMAILS env not set — no admin users bootstrapped');
      return;
    }
    const emails = raw.split(',').map((e) => e.trim()).filter(Boolean);
    if (!emails.length) return;
    try {
      await this.userRepo
        .createQueryBuilder()
        .update(User)
        .set({ isAdmin: true })
        .where('email = ANY(:emails)', { emails })
        .execute();
      this.logger.log(`Admin bootstrap: set is_admin=true for ${emails.length} email(s)`);
    } catch (err) {
      this.logger.error('Admin bootstrap failed', err);
    }
  }

  async generateDrafts(adminId: string, dto: GenerateContentDto): Promise<{ ids: string[]; items: unknown[] }> {
    const language = await this.languageRepo.findOne({
      where: { code: dto.languageCode, isActive: true },
    });
    if (!language) {
      throw new BadRequestException(`Unknown or inactive language: "${dto.languageCode}"`);
    }

    const promptTpl = this.loadPrompt(`${dto.contentType}-draft.md`, {
      languageName: language.name,
      languageCode: language.code,
      level: dto.level,
      count: String(dto.count),
      topicHintLine: dto.topicHint ? `Topic focus: ${dto.topicHint}` : '',
    });

    const raw = await this.llm.chat([new HumanMessage(promptTpl)], {
      model: LLMModel.OPENAI_GPT4O,
      temperature: 0.7,
      maxTokens: 2048,
      metadata: { feature: 'admin-content-generate', adminId, contentType: dto.contentType },
    });

    const items = this.parseJson(raw, dto.count);
    const rows = items.map((item) => this.whitelistFields(item, dto.contentType, language.id));

    const repo = this.repoFor(dto.contentType);
    const saved = await repo.save(rows as any[]);
    return { ids: (saved as ContentRow[]).map((r) => r.id), items: saved };
  }

  async listContent(query: ListContentQueryDto): Promise<{ items: unknown[]; total: number }> {
    const { status, type, languageCode, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const buildQb = async (repo: Repository<any>) => {
      const qb = repo.createQueryBuilder('c').leftJoin('c.language', 'lang');
      if (status) qb.andWhere('c.status = :status', { status });
      if (languageCode) qb.andWhere('lang.code = :code', { code: languageCode });
      qb.addSelect(['lang.code', 'lang.name']);
      return qb.skip(skip).take(limit).getManyAndCount();
    };

    if (type) {
      const [items, total] = await buildQb(this.repoFor(type));
      return { items, total };
    }

    const [lessons, exercises, scenarios] = await Promise.all([
      buildQb(this.lessonRepo),
      buildQb(this.exerciseRepo),
      buildQb(this.scenarioRepo),
    ]);

    return {
      items: [
        ...lessons[0].map((r) => ({ ...r, _type: ContentType.LESSON })),
        ...exercises[0].map((r) => ({ ...r, _type: ContentType.EXERCISE })),
        ...scenarios[0].map((r) => ({ ...r, _type: ContentType.SCENARIO })),
      ],
      total: lessons[1] + exercises[1] + scenarios[1],
    };
  }

  async publishContent(id: string, type: ContentType): Promise<void> {
    await this.updateStatus(id, type, ContentStatus.PUBLISHED);
  }

  async updateContent(id: string, type: ContentType, dto: UpdateContentDto): Promise<void> {
    const repo = this.repoFor(type);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Content not found');
    await repo.update(id, dto as any);
  }

  async archiveContent(id: string, type: ContentType): Promise<void> {
    await this.updateStatus(id, type, ContentStatus.ARCHIVED);
  }

  private async updateStatus(id: string, type: ContentType, status: ContentStatus): Promise<void> {
    const repo = this.repoFor(type);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Content not found');
    await repo.update(id, { status });
  }

  private repoFor(type: ContentType): Repository<any> {
    switch (type) {
      case ContentType.LESSON: return this.lessonRepo;
      case ContentType.EXERCISE: return this.exerciseRepo;
      case ContentType.SCENARIO: return this.scenarioRepo;
      default:
        throw new BadRequestException(`Invalid content type: "${type}"`);
    }
  }

  private whitelistFields(
    item: Record<string, unknown>,
    type: ContentType,
    languageId: string,
  ): Record<string, unknown> {
    const base = {
      title: String(item.title ?? '').substring(0, 255),
      description: typeof item.description === 'string' ? item.description.substring(0, 1000) : undefined,
      difficulty: item.difficulty,
      orderIndex: typeof item.orderIndex === 'number' ? item.orderIndex : 0,
      languageId,
      status: ContentStatus.DRAFT,
    };
    if (type === ContentType.LESSON) {
      return { ...base, isPremium: item.isPremium === true };
    }
    if (type === ContentType.EXERCISE) {
      return {
        ...base,
        type: item.type,
        question: typeof item.question === 'string' ? item.question : '',
        correctAnswer: item.correctAnswer ?? {},
        options: item.options,
        points: typeof item.points === 'number' ? item.points : 10,
      };
    }
    // scenario
    return {
      ...base,
      isPremium: item.isPremium === true,
      isTrial: item.isTrial === true,
    };
  }

  private loadPrompt(filename: string, variables: Record<string, string>): string {
    const filePath = join(this.promptsDir, filename);
    if (!existsSync(filePath)) {
      throw new Error(`Admin prompt template not found: ${filename}`);
    }
    let template = readFileSync(filePath, 'utf-8');
    for (const [key, value] of Object.entries(variables)) {
      template = template.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    return template;
  }

  private parseJson(raw: string, expectedCount: number): Record<string, unknown>[] {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new BadRequestException('LLM returned malformed JSON — retry generation');
    }
    if (!Array.isArray(parsed)) {
      throw new BadRequestException('LLM returned non-array response');
    }
    if (parsed.length !== expectedCount) {
      this.logger.warn(`Expected ${expectedCount} items, got ${parsed.length}`);
    }
    return parsed as Record<string, unknown>[];
  }
}

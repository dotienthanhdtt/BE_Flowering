import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminContentService } from './admin-content.service';
import { Language } from '@/database/entities/language.entity';
import { Lesson } from '@/database/entities/lesson.entity';
import { Exercise } from '@/database/entities/exercise.entity';
import { Scenario } from '@/database/entities/scenario.entity';
import { User } from '@/database/entities/user.entity';
import { ContentStatus } from '@/database/entities/content-status.enum';
import { UnifiedLLMService } from '@/modules/ai/services/unified-llm.service';
import { ContentType, ContentLevel } from './dto/generate-content.dto';
import { AccessTier } from '@/database/entities/access-tier.enum';

const makeRepo = () => ({
  findOne: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const mockLlmService = () => ({ chat: jest.fn() });
const mockConfigService = () => ({ get: jest.fn() });

describe('AdminContentService', () => {
  let service: AdminContentService;
  let languageRepo: ReturnType<typeof makeRepo>;
  let lessonRepo: ReturnType<typeof makeRepo>;
  let exerciseRepo: ReturnType<typeof makeRepo>;
  let scenarioRepo: ReturnType<typeof makeRepo>;
  let userRepo: ReturnType<typeof makeRepo>;
  let llm: ReturnType<typeof mockLlmService>;
  let config: ReturnType<typeof mockConfigService>;

  const mockLanguage: Partial<Language> = {
    id: 'lang-es',
    code: 'es',
    name: 'Spanish',
    isActive: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminContentService,
        { provide: getRepositoryToken(Language), useFactory: makeRepo },
        { provide: getRepositoryToken(Lesson), useFactory: makeRepo },
        { provide: getRepositoryToken(Exercise), useFactory: makeRepo },
        { provide: getRepositoryToken(Scenario), useFactory: makeRepo },
        { provide: getRepositoryToken(User), useFactory: makeRepo },
        { provide: UnifiedLLMService, useFactory: mockLlmService },
        { provide: ConfigService, useFactory: mockConfigService },
      ],
    }).compile();

    service = module.get<AdminContentService>(AdminContentService);
    languageRepo = module.get(getRepositoryToken(Language));
    lessonRepo = module.get(getRepositoryToken(Lesson));
    exerciseRepo = module.get(getRepositoryToken(Exercise));
    scenarioRepo = module.get(getRepositoryToken(Scenario));
    userRepo = module.get(getRepositoryToken(User));
    llm = module.get(UnifiedLLMService);
    config = module.get(ConfigService);
  });


  describe('onModuleInit', () => {
    it('should skip all DB writes in test environment', async () => {
      config.get.mockReturnValue('admin@example.com');
      await service.onModuleInit();
      // NODE_ENV=test guard prevents any DB write
      expect(userRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('generateDrafts', () => {
    const dto = {
      languageCode: 'es',
      contentType: ContentType.LESSON,
      level: ContentLevel.BEGINNER,
      count: 2,
    };

    it('should throw BadRequestException for unknown language', async () => {
      languageRepo.findOne.mockResolvedValue(null);
      await expect(service.generateDrafts('admin-1', dto)).rejects.toThrow(BadRequestException);
    });

    it('should call LLM, parse response, and save drafts', async () => {
      languageRepo.findOne.mockResolvedValue(mockLanguage);
      const llmResponse = JSON.stringify([
        { title: 'Greetings', description: 'Basic greetings', difficulty: 'beginner', orderIndex: 0, accessTier: 'free' },
        { title: 'Numbers', description: 'Count to 10', difficulty: 'beginner', orderIndex: 1, accessTier: 'free' },
      ]);
      llm.chat.mockResolvedValue(llmResponse);
      const saved = [{ id: 'l1' }, { id: 'l2' }];
      lessonRepo.save.mockResolvedValue(saved);

      const result = await service.generateDrafts('admin-1', dto);

      expect(llm.chat).toHaveBeenCalled();
      expect(lessonRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ languageId: 'lang-es', status: ContentStatus.DRAFT, accessTier: AccessTier.FREE }),
        ]),
      );
      expect(result.ids).toEqual(['l1', 'l2']);
    });

    it('should include topicHintLine when topicHint provided', async () => {
      languageRepo.findOne.mockResolvedValue(mockLanguage);
      llm.chat.mockResolvedValue(JSON.stringify([{ title: 'Food vocab' }]));
      lessonRepo.save.mockResolvedValue([{ id: 'l1' }]);

      await service.generateDrafts('admin-1', { ...dto, count: 1, topicHint: 'food' });

      const [messages] = llm.chat.mock.calls[0];
      expect(messages[0].content).toContain('Topic focus: food');
    });

    it('should throw when LLM returns non-array JSON', async () => {
      languageRepo.findOne.mockResolvedValue(mockLanguage);
      llm.chat.mockResolvedValue(JSON.stringify({ error: 'bad' }));

      await expect(service.generateDrafts('admin-1', dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('publishContent', () => {
    it('should set status to published', async () => {
      lessonRepo.findOne.mockResolvedValue({ id: 'l1' });
      await service.publishContent('l1', ContentType.LESSON);
      expect(lessonRepo.update).toHaveBeenCalledWith('l1', { status: ContentStatus.PUBLISHED });
    });

    it('should throw NotFoundException when content not found', async () => {
      lessonRepo.findOne.mockResolvedValue(null);
      await expect(service.publishContent('missing', ContentType.LESSON)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('archiveContent', () => {
    it('should set status to archived', async () => {
      scenarioRepo.findOne.mockResolvedValue({ id: 's1' });
      await service.archiveContent('s1', ContentType.SCENARIO);
      expect(scenarioRepo.update).toHaveBeenCalledWith('s1', { status: ContentStatus.ARCHIVED });
    });
  });

  describe('updateContent', () => {
    it('should update content fields', async () => {
      exerciseRepo.findOne.mockResolvedValue({ id: 'e1' });
      await service.updateContent('e1', ContentType.EXERCISE, { title: 'New title' });
      expect(exerciseRepo.update).toHaveBeenCalledWith('e1', { title: 'New title' });
    });

    it('should throw NotFoundException when content not found', async () => {
      exerciseRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateContent('missing', ContentType.EXERCISE, { title: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

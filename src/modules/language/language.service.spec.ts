import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { LanguageService } from './language.service';
import { Language } from '../../database/entities/language.entity';
import { UserLanguage } from '../../database/entities/user-language.entity';
import { User } from '../../database/entities/user.entity';
import { LanguageType } from './dto/language-query.dto';

const mockLanguageRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
});

const mockUserLanguageRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

const mockUserRepo = () => ({
  update: jest.fn(),
});

describe('LanguageService', () => {
  let service: LanguageService;
  let languageRepo: ReturnType<typeof mockLanguageRepo>;
  let userLanguageRepo: ReturnType<typeof mockUserLanguageRepo>;
  let userRepo: ReturnType<typeof mockUserRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LanguageService,
        { provide: getRepositoryToken(Language), useFactory: mockLanguageRepo },
        { provide: getRepositoryToken(UserLanguage), useFactory: mockUserLanguageRepo },
        { provide: getRepositoryToken(User), useFactory: mockUserRepo },
      ],
    }).compile();

    service = module.get<LanguageService>(LanguageService);
    languageRepo = module.get(getRepositoryToken(Language));
    userLanguageRepo = module.get(getRepositoryToken(UserLanguage));
    userRepo = module.get(getRepositoryToken(User));
  });

  const mockLang = {
    id: 'uuid-1',
    code: 'en',
    name: 'English',
    nativeName: 'English',
    flagUrl: 'http://flag.png',
    isActive: true,
    isNativeAvailable: true,
    isLearningAvailable: true,
    levelFramework: 'CEFR',
  };

  describe('findAll', () => {
    it('should return all active languages when no type filter', async () => {
      languageRepo.find.mockResolvedValue([mockLang]);
      const result = await service.findAll();
      expect(languageRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { name: 'ASC' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].isNativeAvailable).toBe(true);
      expect(result[0].isLearningAvailable).toBe(true);
    });

    it('should filter by native type', async () => {
      languageRepo.find.mockResolvedValue([mockLang]);
      await service.findAll(LanguageType.NATIVE);
      expect(languageRepo.find).toHaveBeenCalledWith({
        where: { isActive: true, isNativeAvailable: true },
        order: { name: 'ASC' },
      });
    });

    it('should filter by learning type', async () => {
      languageRepo.find.mockResolvedValue([mockLang]);
      await service.findAll(LanguageType.LEARNING);
      expect(languageRepo.find).toHaveBeenCalledWith({
        where: { isActive: true, isLearningAvailable: true },
        order: { name: 'ASC' },
      });
    });
  });

  describe('setNativeLanguage', () => {
    const userId = 'user-uuid';
    const langCode = 'en';

    it('should set native language successfully', async () => {
      languageRepo.findOne.mockResolvedValue({ ...mockLang, code: langCode });
      userRepo.update.mockResolvedValue({ affected: 1 });

      const result = await service.setNativeLanguage(userId, { languageCode: langCode });

      expect(userRepo.update).toHaveBeenCalledWith(userId, { nativeLanguage: langCode });
      expect(result.code).toBe(langCode);
    });

    it('should throw NotFoundException for invalid language', async () => {
      languageRepo.findOne.mockResolvedValue(null);
      await expect(
        service.setNativeLanguage(userId, { languageCode: langCode }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for non-native-available language', async () => {
      languageRepo.findOne.mockResolvedValue({ ...mockLang, isNativeAvailable: false });
      await expect(
        service.setNativeLanguage(userId, { languageCode: langCode }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('addUserLanguage', () => {
    const userId = 'user-uuid';
    const langId = 'lang-uuid';
    const mockUserLang = { id: 'ul-1', userId, languageId: langId, lastLearned: true, language: mockLang };

    it('should throw BadRequestException for non-learning-available language', async () => {
      languageRepo.findOne.mockResolvedValue({ ...mockLang, id: langId, isLearningAvailable: false });
      await expect(service.addUserLanguage(userId, { languageId: langId })).rejects.toThrow(BadRequestException);
    });

    it('should deactivate existing active language before adding new one', async () => {
      languageRepo.findOne.mockResolvedValue({ ...mockLang, id: langId });
      userLanguageRepo.findOne.mockResolvedValue(null); // not already added
      userLanguageRepo.create.mockReturnValue(mockUserLang);
      userLanguageRepo.save.mockResolvedValue({ id: 'ul-1' });
      userLanguageRepo.findOne.mockResolvedValueOnce(null).mockResolvedValue(mockUserLang);
      userLanguageRepo.update.mockResolvedValue({ affected: 1 });

      await service.addUserLanguage(userId, { languageId: langId });

      expect(userLanguageRepo.update).toHaveBeenCalledWith(
        { userId, lastLearned: true },
        { lastLearned: false },
      );
    });

    it('should reject invalid level for CEFR language with BadRequestException', async () => {
      languageRepo.findOne.mockResolvedValue({ ...mockLang, id: langId, levelFramework: 'CEFR' });
      userLanguageRepo.findOne.mockResolvedValue(null);

      await expect(
        service.addUserLanguage(userId, { languageId: langId, proficiencyLevel: 'N3' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should default to framework[0] when proficiencyLevel omitted', async () => {
      languageRepo.findOne.mockResolvedValue({ ...mockLang, id: langId, levelFramework: 'JLPT' });
      userLanguageRepo.findOne.mockResolvedValueOnce(null).mockResolvedValue(mockUserLang);
      userLanguageRepo.create.mockReturnValue(mockUserLang);
      userLanguageRepo.save.mockResolvedValue({ id: 'ul-1' });
      userLanguageRepo.update.mockResolvedValue({ affected: 1 });

      await service.addUserLanguage(userId, { languageId: langId });

      expect(userLanguageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ proficiencyLevel: 'N5' }),
      );
    });
  });

  describe('updateUserLanguage', () => {
    const userId = 'user-uuid';
    const languageId = 'lang-uuid';
    const existingUL = {
      id: 'ul-1', userId, languageId, lastLearned: false, language: mockLang,
      proficiencyLevel: 'beginner',
    };

    it('should clear lastLearned on others when setting lastLearned to true', async () => {
      userLanguageRepo.findOne.mockResolvedValue({ ...existingUL });
      userLanguageRepo.update.mockResolvedValue({ affected: 1 });
      userLanguageRepo.save.mockResolvedValue({ ...existingUL, lastLearned: true });

      await service.updateUserLanguage(userId, languageId, { lastLearned: true });

      expect(userLanguageRepo.update).toHaveBeenCalledWith(
        { userId, lastLearned: true },
        { lastLearned: false },
      );
    });

    it('should NOT clear others when setting lastLearned to false', async () => {
      userLanguageRepo.findOne.mockResolvedValue({ ...existingUL, lastLearned: true });
      userLanguageRepo.save.mockResolvedValue({ ...existingUL, lastLearned: false });

      await service.updateUserLanguage(userId, languageId, { lastLearned: false });

      expect(userLanguageRepo.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when user language not found', async () => {
      userLanguageRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateUserLanguage(userId, languageId, { lastLearned: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

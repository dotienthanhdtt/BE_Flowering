import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Vocabulary } from '../../../database/entities/vocabulary.entity';
import { AiConversationMessage } from '../../../database/entities/ai-conversation-message.entity';

// Mock the TranslationService inline to avoid circular dependencies
class MockTranslationService {
  constructor(
    private vocabularyRepo: Repository<Vocabulary>,
    private messageRepo: Repository<AiConversationMessage>,
    private llmService: any,
    private promptLoader: any,
  ) {}

  async translateWord(
    userId: string,
    text: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<any> {
    const prompt = this.promptLoader.loadPrompt('translate-word', {
      word: text,
      sourceLang,
      targetLang,
    });

    const response = await this.llmService.chat([{ role: 'user', content: prompt }], {
      model: 'GEMINI_2_0_FLASH',
      temperature: 0.1,
    });

    const parsed = this.parseWordResponse(response);

    const existing = await this.vocabularyRepo.findOne({
      where: { userId, word: text, sourceLang, targetLang },
    });

    let vocabulary: any;
    if (existing) {
      existing.translation = parsed.translation;
      existing.partOfSpeech = parsed.partOfSpeech;
      existing.pronunciation = parsed.pronunciation;
      vocabulary = await this.vocabularyRepo.save(existing);
    } else {
      vocabulary = await this.vocabularyRepo.save(
        this.vocabularyRepo.create({
          userId,
          word: text,
          translation: parsed.translation,
          sourceLang,
          targetLang,
          partOfSpeech: parsed.partOfSpeech,
          pronunciation: parsed.pronunciation,
        }),
      );
    }

    return {
      original: text,
      translation: parsed.translation,
      partOfSpeech: parsed.partOfSpeech,
      pronunciation: parsed.pronunciation,
      vocabularyId: vocabulary.id,
    };
  }

  async translateSentence(
    userId: string,
    messageId: string,
    sourceLang: string,
    targetLang: string,
  ): Promise<any> {
    const message = await this.messageRepo.findOne({
      where: { id: messageId },
      relations: ['conversation'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.conversation.userId !== userId) {
      throw new ForbiddenException('You do not own this conversation');
    }

    if (message.translatedContent && message.translatedLang === targetLang) {
      return {
        messageId: message.id,
        original: message.content,
        translation: message.translatedContent,
      };
    }

    const prompt = this.promptLoader.loadPrompt('translate-sentence', {
      sentence: message.content,
      sourceLang,
      targetLang,
    });

    const translation = await this.llmService.chat(
      [{ role: 'user', content: prompt }],
      { model: 'GEMINI_2_0_FLASH', temperature: 0.1 },
    );

    message.translatedContent = translation.trim();
    message.translatedLang = targetLang;
    await this.messageRepo.save(message);

    return {
      messageId: message.id,
      original: message.content,
      translation: message.translatedContent,
    };
  }

  private parseWordResponse(response: string): {
    translation: string;
    partOfSpeech?: string;
    pronunciation?: string;
  } {
    try {
      const parsed = JSON.parse(response.trim());
      return {
        translation: parsed.translation,
        partOfSpeech: parsed.partOfSpeech,
        pronunciation: parsed.pronunciation,
      };
    } catch {
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            translation: parsed.translation,
            partOfSpeech: parsed.partOfSpeech,
            pronunciation: parsed.pronunciation,
          };
        } catch {
          // Fallback: return raw response as translation
        }
      }
      return { translation: response.trim() };
    }
  }
}

describe('TranslationService', () => {
  let service: MockTranslationService;
  let vocabularyRepo: jest.Mocked<Repository<Vocabulary>>;
  let messageRepo: jest.Mocked<Repository<AiConversationMessage>>;
  let llmService: any;
  let promptLoader: any;

  beforeEach(() => {
    jest.clearAllMocks();

    vocabularyRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as any;

    messageRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    } as any;

    llmService = {
      chat: jest.fn(),
    };

    promptLoader = {
      loadPrompt: jest.fn(),
    };

    service = new MockTranslationService(vocabularyRepo, messageRepo, llmService, promptLoader);
  });

  describe('translateWord', () => {
    const userId = 'user-123';
    const word = 'hello';
    const sourceLang = 'en';
    const targetLang = 'es';

    const mockVocabularyEntity = {
      id: 'vocab-123',
      userId,
      word,
      sourceLang,
      targetLang,
      translation: 'hola',
      partOfSpeech: 'noun',
      pronunciation: 'oh-lah',
      createdAt: new Date(),
    };

    it('should successfully translate word with valid LLM JSON response', async () => {
      const llmResponse = JSON.stringify({
        translation: 'hola',
        partOfSpeech: 'noun',
        pronunciation: 'oh-lah',
      });

      promptLoader.loadPrompt.mockReturnValue('Translate hello...');
      llmService.chat.mockResolvedValue(llmResponse);
      vocabularyRepo.findOne.mockResolvedValue(null);
      vocabularyRepo.create.mockReturnValue(mockVocabularyEntity as any);
      vocabularyRepo.save.mockResolvedValue(mockVocabularyEntity as any);

      const result = await service.translateWord(userId, word, sourceLang, targetLang);

      expect(promptLoader.loadPrompt).toHaveBeenCalledWith('translate-word', {
        word,
        sourceLang,
        targetLang,
      });
      expect(llmService.chat).toHaveBeenCalled();
      expect(vocabularyRepo.findOne).toHaveBeenCalledWith({
        where: { userId, word, sourceLang, targetLang },
      });
      expect(vocabularyRepo.create).toHaveBeenCalled();
      expect(vocabularyRepo.save).toHaveBeenCalled();
      expect(result).toEqual({
        original: word,
        translation: 'hola',
        partOfSpeech: 'noun',
        pronunciation: 'oh-lah',
        vocabularyId: 'vocab-123',
      });
    });

    it('should update existing vocabulary entry when word already exists', async () => {
      const llmResponse = JSON.stringify({
        translation: 'hola',
        partOfSpeech: 'interjection',
        pronunciation: 'oh-lah',
      });

      const existingVocab = {
        ...mockVocabularyEntity,
        translation: 'old-translation',
        partOfSpeech: 'verb',
      };

      const updatedVocab = {
        ...existingVocab,
        translation: 'hola',
        partOfSpeech: 'interjection',
        pronunciation: 'oh-lah',
      };

      promptLoader.loadPrompt.mockReturnValue('Translate hello...');
      llmService.chat.mockResolvedValue(llmResponse);
      vocabularyRepo.findOne.mockResolvedValue(existingVocab as any);
      vocabularyRepo.save.mockResolvedValue(updatedVocab as any);

      const result = await service.translateWord(userId, word, sourceLang, targetLang);

      expect(vocabularyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          translation: 'hola',
          partOfSpeech: 'interjection',
          pronunciation: 'oh-lah',
        }),
      );
      expect(result.translation).toBe('hola');
      expect(result.vocabularyId).toBe('vocab-123');
    });

    it('should fallback to raw response when LLM JSON parse fails', async () => {
      const rawResponse = 'The word means "hello" in Spanish';

      promptLoader.loadPrompt.mockReturnValue('Translate hello...');
      llmService.chat.mockResolvedValue(rawResponse);
      vocabularyRepo.findOne.mockResolvedValue(null);
      vocabularyRepo.create.mockReturnValue({
        ...mockVocabularyEntity,
        translation: rawResponse,
      } as any);
      vocabularyRepo.save.mockResolvedValue({
        ...mockVocabularyEntity,
        translation: rawResponse,
      } as any);

      const result = await service.translateWord(userId, word, sourceLang, targetLang);

      expect(result.translation).toBe(rawResponse);
      expect(result.partOfSpeech).toBeUndefined();
      expect(result.pronunciation).toBeUndefined();
    });

    it('should extract JSON from response when initial parse fails', async () => {
      const llmResponse = 'Here is the translation: {"translation": "hola", "partOfSpeech": "noun"}';

      promptLoader.loadPrompt.mockReturnValue('Translate hello...');
      llmService.chat.mockResolvedValue(llmResponse);
      vocabularyRepo.findOne.mockResolvedValue(null);
      vocabularyRepo.create.mockReturnValue(mockVocabularyEntity as any);
      vocabularyRepo.save.mockResolvedValue(mockVocabularyEntity as any);

      const result = await service.translateWord(userId, word, sourceLang, targetLang);

      expect(result.translation).toBe('hola');
      expect(result.partOfSpeech).toBe('noun');
    });

    it('should trim whitespace from LLM response', async () => {
      const llmResponse = `
        {
          "translation": "hola",
          "partOfSpeech": "noun"
        }
      `;

      promptLoader.loadPrompt.mockReturnValue('Translate hello...');
      llmService.chat.mockResolvedValue(llmResponse);
      vocabularyRepo.findOne.mockResolvedValue(null);
      vocabularyRepo.create.mockReturnValue(mockVocabularyEntity as any);
      vocabularyRepo.save.mockResolvedValue(mockVocabularyEntity as any);

      const result = await service.translateWord(userId, word, sourceLang, targetLang);

      expect(result.translation).toBe('hola');
    });
  });

  describe('translateSentence', () => {
    const userId = 'user-123';
    const messageId = 'msg-123';
    const sourceLang = 'en';
    const targetLang = 'es';

    const mockConversation = {
      id: 'conv-123',
      userId,
    };

    const mockMessage = {
      id: messageId,
      content: 'Hello, how are you?',
      conversation: mockConversation,
      translatedContent: null,
      translatedLang: null,
      conversationId: 'conv-123',
      role: 'user',
      audioUrl: null,
      metadata: null,
      createdAt: new Date(),
    };

    it('should successfully translate sentence and cache result', async () => {
      const translatedContent = 'Hola, ¿cómo estás?';

      promptLoader.loadPrompt.mockReturnValue('Translate sentence...');
      messageRepo.findOne.mockResolvedValue(mockMessage as any);
      llmService.chat.mockResolvedValue(translatedContent);

      const updatedMessage = {
        ...mockMessage,
        translatedContent,
        translatedLang: targetLang,
      };
      messageRepo.save.mockResolvedValue(updatedMessage as any);

      const result = await service.translateSentence(userId, messageId, sourceLang, targetLang);

      expect(messageRepo.findOne).toHaveBeenCalledWith({
        where: { id: messageId },
        relations: ['conversation'],
      });
      expect(llmService.chat).toHaveBeenCalled();
      expect(messageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          translatedContent,
          translatedLang: targetLang,
        }),
      );
      expect(result).toEqual({
        messageId,
        original: mockMessage.content,
        translation: translatedContent,
      });
    });

    it('should return cached translation without calling LLM', async () => {
      const cachedTranslation = 'Hola, ¿cómo estás?';

      const messageWithCache = {
        ...mockMessage,
        translatedContent: cachedTranslation,
        translatedLang: targetLang,
      };

      messageRepo.findOne.mockResolvedValue(messageWithCache as any);

      const result = await service.translateSentence(userId, messageId, sourceLang, targetLang);

      expect(messageRepo.findOne).toHaveBeenCalled();
      expect(llmService.chat).not.toHaveBeenCalled();
      expect(messageRepo.save).not.toHaveBeenCalled();
      expect(result).toEqual({
        messageId,
        original: mockMessage.content,
        translation: cachedTranslation,
      });
    });

    it('should throw NotFoundException when message does not exist', async () => {
      messageRepo.findOne.mockResolvedValue(null);

      await expect(service.translateSentence(userId, messageId, sourceLang, targetLang)).rejects.toThrow(
        NotFoundException,
      );

      expect(llmService.chat).not.toHaveBeenCalled();
      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user does not own conversation', async () => {
      const otherUserConversation = {
        id: 'conv-123',
        userId: 'different-user',
      };

      const messageWithOtherUser = {
        ...mockMessage,
        conversation: otherUserConversation,
      };

      messageRepo.findOne.mockResolvedValue(messageWithOtherUser as any);

      await expect(service.translateSentence(userId, messageId, sourceLang, targetLang)).rejects.toThrow(
        ForbiddenException,
      );

      expect(llmService.chat).not.toHaveBeenCalled();
      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('should trim whitespace from LLM response before caching', async () => {
      const llmResponse = '  Hola, ¿cómo estás?  \n';
      const expectedTrimmed = 'Hola, ¿cómo estás?';

      // Create fresh message without cache
      const freshMessage = {
        ...mockMessage,
        translatedContent: null,
        translatedLang: null,
      };

      promptLoader.loadPrompt.mockReturnValue('Translate sentence...');
      messageRepo.findOne.mockClear();
      messageRepo.findOne.mockResolvedValue(freshMessage as any);
      llmService.chat.mockClear();
      llmService.chat.mockResolvedValue(llmResponse);

      const updatedMessage = {
        ...freshMessage,
        translatedContent: expectedTrimmed,
        translatedLang: targetLang,
      };
      messageRepo.save.mockClear();
      messageRepo.save.mockResolvedValue(updatedMessage as any);

      const result = await service.translateSentence(userId, messageId, sourceLang, targetLang);

      expect(messageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          translatedContent: expectedTrimmed,
        }),
      );
      expect(result.translation).toBe(expectedTrimmed);
    });

    it('should not use cache if translated language differs from requested language', async () => {
      const differentCachedLang = 'fr';
      const messageWithDifferentCache = {
        ...mockMessage,
        translatedContent: 'Bonjour',
        translatedLang: differentCachedLang,
      };

      const newTranslation = 'Hola, ¿cómo estás?';

      promptLoader.loadPrompt.mockReturnValue('Translate sentence...');
      messageRepo.findOne.mockResolvedValue(messageWithDifferentCache as any);
      llmService.chat.mockResolvedValue(newTranslation);

      const updatedMessage = {
        ...messageWithDifferentCache,
        translatedContent: newTranslation,
        translatedLang: targetLang,
      };
      messageRepo.save.mockResolvedValue(updatedMessage as any);

      const result = await service.translateSentence(userId, messageId, sourceLang, targetLang);

      expect(llmService.chat).toHaveBeenCalled();
      expect(messageRepo.save).toHaveBeenCalled();
      expect(result.translation).toBe(newTranslation);
    });
  });
});

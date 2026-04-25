import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioChatController } from './scenario-chat.controller';
import { ScenarioChatService } from './services/scenario-chat.service';
import { ScenarioChatRequestDto, ScenarioChatResponseDto } from './dto/scenario-chat.dto';
import { ScenarioChatStatus } from '../../database/entities/ai-conversation.entity';
import { ThrottlerGuard } from '@nestjs/throttler';

const mockScenarioChatService = () => ({
  chat: jest.fn(),
  listConversations: jest.fn(),
  getConversation: jest.fn(),
});

interface MockRequest {
  user?: { id: string };
}

describe('ScenarioChatController', () => {
  let controller: ScenarioChatController;
  let service: ReturnType<typeof mockScenarioChatService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScenarioChatController],
      providers: [
        { provide: ScenarioChatService, useFactory: mockScenarioChatService },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<ScenarioChatController>(ScenarioChatController);
    service = module.get(ScenarioChatService);
  });

  const mockUserId = 'user-uuid-1';
  const mockScenarioId = 'scenario-uuid-1';
  const mockConversationId = 'convo-uuid-1';

  const mockResponse: ScenarioChatResponseDto = {
    scenario: {
      conversation_id: mockConversationId,
      max_turns: 12,
      turn: 1,
      status: ScenarioChatStatus.CHATTING,
    },
    messages: [],
  };

  const mockLang = { id: 'lang-en', code: 'en' };

  describe('chat', () => {
    it('should delegate to service and return response', async () => {
      service.chat.mockResolvedValue(mockResponse);

      const req: MockRequest = { user: { id: mockUserId } };
      const dto: ScenarioChatRequestDto = {
        scenarioId: mockScenarioId,
        message: 'Hello',
      };

      const result = await controller.chat(req as any, mockLang, dto);

      expect(service.chat).toHaveBeenCalledWith(mockUserId, dto, 'lang-en');
      expect(result).toEqual(mockResponse);
    });

    it('should pass userId from request to service', async () => {
      service.chat.mockResolvedValue(mockResponse);

      const req: MockRequest = { user: { id: mockUserId } };
      const dto: ScenarioChatRequestDto = { scenarioId: mockScenarioId };

      await controller.chat(req as any, mockLang, dto);

      expect(service.chat).toHaveBeenCalledWith(mockUserId, expect.any(Object), 'lang-en');
    });

    it('should pass entire DTO to service', async () => {
      service.chat.mockResolvedValue(mockResponse);

      const req: MockRequest = { user: { id: mockUserId } };
      const dto: ScenarioChatRequestDto = {
        scenarioId: mockScenarioId,
        message: 'User message',
        conversationId: mockConversationId,
      };

      await controller.chat(req as any, mockLang, dto);

      expect(service.chat).toHaveBeenCalledWith(mockUserId, dto, 'lang-en');
    });

    it('should return service response as-is', async () => {
      const customResponse: ScenarioChatResponseDto = {
        scenario: {
          conversation_id: 'custom-convo-uuid',
          max_turns: 12,
          turn: 5,
          status: ScenarioChatStatus.CHATTING,
        },
        messages: [],
      };
      service.chat.mockResolvedValue(customResponse);

      const req: MockRequest = { user: { id: mockUserId } };
      const dto: ScenarioChatRequestDto = { scenarioId: mockScenarioId };

      const result = await controller.chat(req as any, mockLang, dto);

      expect(result).toBe(customResponse);
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      service.chat.mockRejectedValue(error);

      const req: MockRequest = { user: { id: mockUserId } };
      const dto: ScenarioChatRequestDto = { scenarioId: mockScenarioId };

      await expect(controller.chat(req as any, mockLang, dto)).rejects.toThrow('Service error');
    });

    it('should pass forceNew flag through to service', async () => {
      service.chat.mockResolvedValue(mockResponse);
      const req: MockRequest = { user: { id: mockUserId } };
      const dto: ScenarioChatRequestDto = { scenarioId: mockScenarioId, forceNew: true };

      await controller.chat(req as any, mockLang, dto);

      expect(service.chat).toHaveBeenCalledWith(
        mockUserId,
        expect.objectContaining({ forceNew: true }),
        'lang-en',
      );
    });
  });

  describe('listConversations', () => {
    it('should delegate to service and return list', async () => {
      const listResponse = {
        items: [
          {
            id: mockConversationId,
            startedAt: '2026-04-14T09:00:00.000Z',
            lastTurnAt: '2026-04-14T09:15:00.000Z',
            turnCount: 5,
            status: ScenarioChatStatus.CHATTING,
            maxTurns: 12,
          },
        ],
      };
      service.listConversations.mockResolvedValue(listResponse);

      const req: MockRequest = { user: { id: mockUserId } };
      const result = await controller.listConversations(req as any, mockScenarioId);

      expect(service.listConversations).toHaveBeenCalledWith(mockUserId, mockScenarioId);
      expect(result).toBe(listResponse);
    });
  });

  describe('getConversation', () => {
    it('should delegate to service and return transcript', async () => {
      const detail: ScenarioChatResponseDto = {
        scenario: {
          conversation_id: mockConversationId,
          max_turns: 12,
          turn: 12,
          status: ScenarioChatStatus.DONE,
        },
        messages: [],
      };
      service.getConversation.mockResolvedValue(detail);

      const req: MockRequest = { user: { id: mockUserId } };
      const result = await controller.getConversation(req as any, mockConversationId);

      expect(service.getConversation).toHaveBeenCalledWith(mockUserId, mockConversationId);
      expect(result).toBe(detail);
    });
  });
});

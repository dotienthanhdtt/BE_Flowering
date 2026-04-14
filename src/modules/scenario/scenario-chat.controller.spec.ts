import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioChatController } from './scenario-chat.controller';
import { ScenarioChatService } from './services/scenario-chat.service';
import { ScenarioChatRequestDto, ScenarioChatResponseDto } from './dto/scenario-chat.dto';
import { ThrottlerGuard } from '@nestjs/throttler';

const mockScenarioChatService = () => ({
  chat: jest.fn(),
  listConversations: jest.fn(),
  getConversation: jest.fn(),
});

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
    reply: 'Welcome to the restaurant!',
    conversationId: mockConversationId,
    turn: 1,
    maxTurns: 12,
    completed: false,
  };

  describe('chat', () => {
    it('should delegate to service and return response', async () => {
      service.chat.mockResolvedValue(mockResponse);

      const req = { user: { id: mockUserId } };
      const dto: ScenarioChatRequestDto = {
        scenarioId: mockScenarioId,
        message: 'Hello',
      };

      const result = await controller.chat(req, dto);

      expect(service.chat).toHaveBeenCalledWith(mockUserId, dto);
      expect(result).toEqual(mockResponse);
    });

    it('should pass userId from request to service', async () => {
      service.chat.mockResolvedValue(mockResponse);

      const req = { user: { id: mockUserId } };
      const dto: ScenarioChatRequestDto = { scenarioId: mockScenarioId };

      await controller.chat(req, dto);

      expect(service.chat).toHaveBeenCalledWith(mockUserId, expect.any(Object));
    });

    it('should pass entire DTO to service', async () => {
      service.chat.mockResolvedValue(mockResponse);

      const req = { user: { id: mockUserId } };
      const dto: ScenarioChatRequestDto = {
        scenarioId: mockScenarioId,
        message: 'User message',
        conversationId: mockConversationId,
      };

      await controller.chat(req, dto);

      expect(service.chat).toHaveBeenCalledWith(mockUserId, dto);
    });

    it('should return service response as-is', async () => {
      const customResponse: ScenarioChatResponseDto = {
        reply: 'Custom reply',
        conversationId: 'custom-convo-uuid',
        turn: 5,
        maxTurns: 12,
        completed: false,
      };
      service.chat.mockResolvedValue(customResponse);

      const req = { user: { id: mockUserId } };
      const dto: ScenarioChatRequestDto = { scenarioId: mockScenarioId };

      const result = await controller.chat(req, dto);

      expect(result).toBe(customResponse);
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      service.chat.mockRejectedValue(error);

      const req = { user: { id: mockUserId } };
      const dto: ScenarioChatRequestDto = { scenarioId: mockScenarioId };

      await expect(controller.chat(req, dto)).rejects.toThrow('Service error');
    });

    it('should pass forceNew flag through to service', async () => {
      service.chat.mockResolvedValue(mockResponse);
      const req = { user: { id: mockUserId } };
      const dto: ScenarioChatRequestDto = { scenarioId: mockScenarioId, forceNew: true };

      await controller.chat(req, dto);

      expect(service.chat).toHaveBeenCalledWith(
        mockUserId,
        expect.objectContaining({ forceNew: true }),
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
            completed: false,
            maxTurns: 12,
          },
        ],
      };
      service.listConversations.mockResolvedValue(listResponse);

      const req = { user: { id: mockUserId } };
      const result = await controller.listConversations(req, mockScenarioId);

      expect(service.listConversations).toHaveBeenCalledWith(mockUserId, mockScenarioId);
      expect(result).toBe(listResponse);
    });
  });

  describe('getConversation', () => {
    it('should delegate to service and return transcript', async () => {
      const detail = {
        id: mockConversationId,
        scenarioId: mockScenarioId,
        completed: true,
        turn: 12,
        maxTurns: 12,
        messages: [],
      };
      service.getConversation.mockResolvedValue(detail);

      const req = { user: { id: mockUserId } };
      const result = await controller.getConversation(req, mockConversationId);

      expect(service.getConversation).toHaveBeenCalledWith(mockUserId, mockConversationId);
      expect(result).toBe(detail);
    });
  });
});

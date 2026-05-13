import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioChatController } from './scenario-chat.controller';
import { ScenarioChatService } from './services/scenario-chat.service';
import { ScenarioChatRequestDto, ScenarioChatResponseDto } from './dto/scenario-chat.dto';
import { ScenarioChatStatus } from '../../database/entities/ai-conversation.entity';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ResourceAccessGuard } from '@common/guards/resource-access.guard';

const mockScenarioChatService = () => ({
  chat: jest.fn(),
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
      .overrideGuard(ResourceAccessGuard)
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

  });
});

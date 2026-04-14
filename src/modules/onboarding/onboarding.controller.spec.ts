// Prevent auto-mock from loading onboarding.service → unified-llm → langfuse chain (ESM issue)
jest.mock('./onboarding.service', () => ({ OnboardingService: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { OnboardingThrottlerGuard } from './onboarding-throttler.guard';

const VALID_UUID = '7e982513-fff0-4d07-b008-36dd8047c326';

const mockOnboardingService = () => ({
  handleChat: jest.fn(),
  complete: jest.fn(),
});

describe('OnboardingController', () => {
  let controller: OnboardingController;
  let service: ReturnType<typeof mockOnboardingService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OnboardingController],
      providers: [{ provide: OnboardingService, useFactory: mockOnboardingService }],
    })
      .overrideGuard(OnboardingThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(OnboardingController);
    service = module.get(OnboardingService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('chat', () => {
    it('delegates to service.handleChat when creating a new session (no conversationId)', async () => {
      const dto = { nativeLanguage: 'vi', targetLanguage: 'en' };
      const expected = {
        conversationId: VALID_UUID,
        reply: 'Hello! Welcome.',
        messageId: 'msg-1',
        turnNumber: 1,
        isLastTurn: false,
      };
      service.handleChat.mockResolvedValue(expected);

      const result = await controller.chat(dto as any);

      expect(service.handleChat).toHaveBeenCalledWith(dto);
      expect(service.handleChat).toHaveBeenCalledTimes(1);
      expect(result).toBe(expected);
    });

    it('delegates to service.handleChat when continuing a session (with conversationId)', async () => {
      const dto = { conversationId: VALID_UUID, message: 'Hello' };
      const expected = {
        conversationId: VALID_UUID,
        reply: 'Hi!',
        messageId: 'msg-2',
        turnNumber: 2,
        isLastTurn: false,
      };
      service.handleChat.mockResolvedValue(expected);

      const result = await controller.chat(dto as any);

      expect(service.handleChat).toHaveBeenCalledWith(dto);
      expect(result).toBe(expected);
    });
  });

  describe('complete', () => {
    it('delegates to service.complete with DTO', async () => {
      const dto = { conversationId: VALID_UUID };
      const expected = { nativeLanguage: 'English', level: 'beginner' };
      service.complete.mockResolvedValue(expected);

      const result = await controller.complete(dto as any);

      expect(service.complete).toHaveBeenCalledWith(dto);
      expect(result).toBe(expected);
    });
  });
});

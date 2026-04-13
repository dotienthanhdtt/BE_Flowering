// Prevent auto-mock from loading onboarding.service → unified-llm → langfuse chain (ESM issue)
jest.mock('./onboarding.service', () => ({ OnboardingService: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

const mockOnboardingService = () => ({
  startSession: jest.fn(),
  chat: jest.fn(),
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
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(OnboardingController);
    service = module.get(OnboardingService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('start', () => {
    it('delegates to service.startSession with DTO', async () => {
      const dto = { nativeLanguage: 'English', targetLanguage: 'Spanish' };
      const expected = { conversationId: 'c1' };
      service.startSession.mockResolvedValue(expected);

      const result = await controller.start(dto as any);

      expect(service.startSession).toHaveBeenCalledWith(dto);
      expect(result).toBe(expected);
    });
  });

  describe('chat', () => {
    it('delegates to service.chat with DTO', async () => {
      const dto = { conversationId: 'c1', message: 'Hello' };
      const expected = { reply: 'Hi!', turnNumber: 1, isLastTurn: false };
      service.chat.mockResolvedValue(expected);

      const result = await controller.chat(dto as any);

      expect(service.chat).toHaveBeenCalledWith(dto);
      expect(result).toBe(expected);
    });
  });

  describe('complete', () => {
    it('delegates to service.complete with DTO', async () => {
      const dto = { conversationId: 'c1' };
      const expected = { nativeLanguage: 'English', level: 'beginner' };
      service.complete.mockResolvedValue(expected);

      const result = await controller.complete(dto as any);

      expect(service.complete).toHaveBeenCalledWith(dto);
      expect(result).toBe(expected);
    });
  });
});

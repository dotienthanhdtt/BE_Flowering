import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TtsService, TTS_MAX_CHARS } from './tts.service';
import { MessageRole } from '../../../database/entities/ai-conversation-message.entity';
import { AiConversationType } from '../../../database/entities/ai-conversation.entity';

function makeMessage(overrides: Partial<{
  id: string;
  role: MessageRole;
  content: string;
  audioUrl?: string;
  conversationId: string;
  conversation: {
    id: string;
    userId?: string | null;
    type: AiConversationType;
  };
}> = {}) {
  return {
    id: overrides.id ?? 'msg-1',
    role: overrides.role ?? MessageRole.ASSISTANT,
    content: overrides.content ?? 'hello world',
    audioUrl: overrides.audioUrl,
    conversationId: overrides.conversationId ?? 'conv-1',
    conversation: overrides.conversation ?? {
      id: overrides.conversationId ?? 'conv-1',
      userId: 'user-1',
      type: AiConversationType.AUTHENTICATED,
    },
  };
}

describe('TtsService', () => {
  let service: TtsService;
  let tts: { name: string; defaultMimeType: string; synthesize: jest.Mock };
  let storage: { uploadAudio: jest.Mock; getSignedUrl: jest.Mock };
  let langfuse: { getConversationContext: jest.Mock; recordEvent: jest.Mock };
  let repo: { findOne: jest.Mock; update: jest.Mock };

  beforeEach(() => {
    // FallbackTtsProvider mock. Same shape as the wrapper exposes
    // (name, defaultMimeType, synthesize). `synthesize` returns a result
    // tagged with `provider` so callers can attribute Langfuse events.
    tts = {
      name: 'tts-fallback',
      defaultMimeType: 'audio/mpeg',
      synthesize: jest.fn(),
    };
    storage = {
      uploadAudio: jest.fn(),
      getSignedUrl: jest.fn(),
    };
    langfuse = {
      getConversationContext: jest.fn(),
      recordEvent: jest.fn(),
    };
    repo = { findOne: jest.fn(), update: jest.fn() };

    service = new TtsService(tts as never, storage as never, langfuse as never, repo as never);
  });

  describe('synthesizeMessage — cache miss (scenario)', () => {
    it('synthesizes, uploads, persists path, returns signed URL', async () => {
      repo.findOne.mockResolvedValue(makeMessage());
      tts.synthesize.mockResolvedValue({
        audio: Buffer.from([1, 2, 3]),
        mimeType: 'audio/mpeg',
        provider: 'soniox',
      });
      storage.uploadAudio.mockResolvedValue({
        path: 'user-1/audio/123-tts/msg-1.mp3',
        signedUrl: 'https://signed-url',
      });

      const result = await service.synthesizeMessage('msg-1', {
        kind: 'scenario',
        userId: 'user-1',
      });

      expect(result).toEqual({
        audioUrl: 'https://signed-url',
        mimeType: 'audio/mpeg',
        cached: false,
      });
      expect(tts.synthesize).toHaveBeenCalledWith('hello world', { language: 'en' });
      expect(repo.update).toHaveBeenCalledWith('msg-1', {
        audioUrl: 'user-1/audio/123-tts/msg-1.mp3',
      });
      expect(langfuse.recordEvent).toHaveBeenCalledWith(
        'conv-1',
        'tts.synthesize',
        expect.objectContaining({ provider: 'soniox', char_count: 11 }),
      );
    });
  });

  describe('synthesizeMessage — cache hit', () => {
    it('re-signs stored path, skips TTS provider, emits cache provider attribute', async () => {
      repo.findOne.mockResolvedValue(makeMessage({ audioUrl: 'user-1/audio/old.mp3' }));
      storage.getSignedUrl.mockResolvedValue('https://fresh-signed');

      const result = await service.synthesizeMessage('msg-1', {
        kind: 'scenario',
        userId: 'user-1',
      });

      expect(result).toEqual({
        audioUrl: 'https://fresh-signed',
        mimeType: 'audio/mpeg',
        cached: true,
      });
      expect(tts.synthesize).not.toHaveBeenCalled();
      expect(storage.uploadAudio).not.toHaveBeenCalled();
      expect(storage.getSignedUrl).toHaveBeenCalledWith('user-1/audio/old.mp3', 3600);
      // [RT-C] cache_hit must report provider='cache', not a provider name —
      // the actual producer of the bytes is unknowable post-hoc.
      expect(langfuse.recordEvent).toHaveBeenCalledWith(
        'conv-1',
        'tts.cache_hit',
        expect.objectContaining({ provider: 'cache' }),
      );
    });
  });

  describe('authorization guards', () => {
    it('404 when message missing', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.synthesizeMessage('msg-1', { kind: 'scenario', userId: 'user-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('403 when role is not assistant', async () => {
      repo.findOne.mockResolvedValue(makeMessage({ role: MessageRole.USER }));
      await expect(
        service.synthesizeMessage('msg-1', { kind: 'scenario', userId: 'user-1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('400 when content exceeds 5000 chars', async () => {
      repo.findOne.mockResolvedValue(makeMessage({ content: 'x'.repeat(TTS_MAX_CHARS + 1) }));
      await expect(
        service.synthesizeMessage('msg-1', { kind: 'scenario', userId: 'user-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('403 scenario when conversation belongs to another user', async () => {
      repo.findOne.mockResolvedValue(
        makeMessage({
          conversation: { id: 'conv-1', userId: 'someone-else', type: AiConversationType.AUTHENTICATED },
        }),
      );
      await expect(
        service.synthesizeMessage('msg-1', { kind: 'scenario', userId: 'user-1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('403 onboarding when conversationId mismatch', async () => {
      repo.findOne.mockResolvedValue(
        makeMessage({
          conversation: { id: 'conv-A', userId: null, type: AiConversationType.ANONYMOUS },
          conversationId: 'conv-A',
        }),
      );
      await expect(
        service.synthesizeMessage('msg-1', {
          kind: 'onboarding',
          sessionId: 'sess-1',
          conversationId: 'conv-B',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('403 onboarding when conversation has userId set', async () => {
      repo.findOne.mockResolvedValue(
        makeMessage({
          conversation: { id: 'conv-1', userId: 'user-1', type: AiConversationType.ANONYMOUS },
        }),
      );
      await expect(
        service.synthesizeMessage('msg-1', {
          kind: 'onboarding',
          sessionId: 'sess-1',
          conversationId: 'conv-1',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('403 onboarding when conversation type not onboarding', async () => {
      repo.findOne.mockResolvedValue(
        makeMessage({
          conversation: { id: 'conv-1', userId: null, type: AiConversationType.AUTHENTICATED },
        }),
      );
      await expect(
        service.synthesizeMessage('msg-1', {
          kind: 'onboarding',
          sessionId: 'sess-1',
          conversationId: 'conv-1',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows onboarding with ANONYMOUS type + null userId + matching conversationId', async () => {
      repo.findOne.mockResolvedValue(
        makeMessage({
          conversation: { id: 'conv-1', userId: null, type: AiConversationType.ANONYMOUS },
        }),
      );
      tts.synthesize.mockResolvedValue({ audio: Buffer.from([1]), mimeType: 'audio/mpeg', provider: 'soniox' });
      storage.uploadAudio.mockResolvedValue({ path: 'p', signedUrl: 'u' });

      await expect(
        service.synthesizeMessage('msg-1', {
          kind: 'onboarding',
          sessionId: 'sess-1',
          conversationId: 'conv-1',
        }),
      ).resolves.toMatchObject({ audioUrl: 'u' });
    });
  });

  describe('principalNamespace', () => {
    it('returns userId for scenario', () => {
      expect(service.principalNamespace({ kind: 'scenario', userId: 'u' })).toBe('u');
    });

    it('returns onboarding-prefixed sessionId for onboarding', () => {
      expect(
        service.principalNamespace({ kind: 'onboarding', sessionId: 's', conversationId: 'c' }),
      ).toBe('onboarding:s');
    });
  });
});

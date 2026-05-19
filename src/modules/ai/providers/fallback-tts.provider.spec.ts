import { ServiceUnavailableException } from '@nestjs/common';
import { FallbackTtsProvider } from './fallback-tts.provider';
import { TtsStreamHandle, TtsResult } from './tts-provider.interface';

describe('FallbackTtsProvider', () => {
  let provider: FallbackTtsProvider;
  let configService: { get: jest.Mock };
  let mockPrimary: any;
  let mockSecondary: any;
  let mockLoggerWarn: jest.Mock;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        const map: Record<string, unknown> = {
          'ai.ttsFallbackEnabled': true,
          'ai.ttsFallbackTimeoutMs': 3000,
          'ai.alibabaTtsFormat': 'mp3',
        };
        return map[key];
      }),
    };

    mockPrimary = {
      name: 'soniox',
      supportsStreaming: true,
      isAvailable: jest.fn(() => true),
      supportsFormat: jest.fn((fmt: string) => ['mp3', 'wav', 'pcm_s16le'].includes(fmt)),
      synthesize: jest.fn(),
      openStream: jest.fn(),
    };

    mockSecondary = {
      name: 'alibaba-cosyvoice',
      supportsStreaming: true,
      isAvailable: jest.fn(() => true),
      supportsFormat: jest.fn((fmt: string) => ['mp3', 'wav', 'pcm', 'pcm_s16le', 'opus'].includes(fmt)),
      synthesize: jest.fn(),
      openStream: jest.fn(),
    };

    const mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    mockLoggerWarn = mockLogger.warn;

    provider = new FallbackTtsProvider(
      mockPrimary as any,
      mockSecondary as any,
      configService as never,
    );
    (provider as any).logger = mockLogger;

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('isAvailable', () => {
    it('returns true when primary available', () => {
      mockPrimary.isAvailable.mockReturnValue(true);
      mockSecondary.isAvailable.mockReturnValue(false);
      expect(provider.isAvailable()).toBe(true);
    });

    it('returns true when secondary available', () => {
      mockPrimary.isAvailable.mockReturnValue(false);
      mockSecondary.isAvailable.mockReturnValue(true);
      expect(provider.isAvailable()).toBe(true);
    });

    it('returns false when both unavailable', () => {
      mockPrimary.isAvailable.mockReturnValue(false);
      mockSecondary.isAvailable.mockReturnValue(false);
      expect(provider.isAvailable()).toBe(false);
    });
  });

  describe('supportsFormat', () => {
    it('returns true if primary supports', () => {
      expect(provider.supportsFormat('mp3')).toBe(true);
    });

    it('returns true if secondary supports (even if primary does not)', () => {
      mockPrimary.supportsFormat.mockReturnValue(false);
      mockSecondary.supportsFormat.mockReturnValue(true);
      expect(provider.supportsFormat('opus')).toBe(true);
    });

    it('returns false if neither supports', () => {
      mockPrimary.supportsFormat.mockReturnValue(false);
      mockSecondary.supportsFormat.mockReturnValue(false);
      expect(provider.supportsFormat('flac')).toBe(false);
    });
  });

  describe('openStream happy path', () => {
    it('primary emits first audio before 3s deadline → only primary.openStream called', () => {
      const mockPrimaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockPrimary.openStream.mockReturnValue(mockPrimaryHandle as TtsStreamHandle);

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      expect(mockPrimary.openStream).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: 'trace-1',
          audioFormat: 'mp3',
          sampleRate: 24000,
        }),
      );
      expect(mockSecondary.openStream).not.toHaveBeenCalled();

      // Simulate primary emitting audio before deadline
      const onAudioCallback = (mockPrimaryHandle.onAudio as jest.Mock).mock.calls[0]?.[0];
      onAudioCallback(Buffer.from([0x01, 0x02]));

      expect(mockSecondary.openStream).not.toHaveBeenCalled();
      expect((handle as any).getWinnerProvider()).toBe('soniox');

      handle.forceClose();
    });

    it('primary errors before audio → secondary.openStream called immediately', () => {
      const mockPrimaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockPrimary.openStream.mockReturnValue(mockPrimaryHandle as TtsStreamHandle);

      const mockSecondaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockSecondary.openStream.mockReturnValue(mockSecondaryHandle as TtsStreamHandle);

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      // Simulate primary error
      const onErrorCallback = (mockPrimaryHandle.onError as jest.Mock).mock.calls[0]?.[0];
      onErrorCallback(new Error('Primary failed'));

      // Let microtasks run
      jest.runAllTicks();

      expect(mockSecondary.openStream).toHaveBeenCalled();
      expect((handle as any).getWinnerProvider()).toBe('alibaba-cosyvoice');
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('tts.fallback_fired'),
      );

      handle.forceClose();
    });

    it('3s deadline elapses with no audio → secondary.openStream called', () => {
      const mockPrimaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockPrimary.openStream.mockReturnValue(mockPrimaryHandle as TtsStreamHandle);

      const mockSecondaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockSecondary.openStream.mockReturnValue(mockSecondaryHandle as TtsStreamHandle);

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      expect(mockSecondary.openStream).not.toHaveBeenCalled();

      // Advance to 3001ms (past deadline)
      jest.advanceTimersByTime(3001);

      expect(mockSecondary.openStream).toHaveBeenCalled();
      expect(mockPrimaryHandle.forceClose).toHaveBeenCalled();
      expect((handle as any).getWinnerProvider()).toBe('alibaba-cosyvoice');

      handle.forceClose();
    });
  });

  describe('forceClose during race window [RT-E]', () => {
    it('forceClose before deadline fires → secondary never opens', () => {
      const mockPrimaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockPrimary.openStream.mockReturnValue(mockPrimaryHandle as TtsStreamHandle);

      const mockSecondaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockSecondary.openStream.mockReturnValue(mockSecondaryHandle as TtsStreamHandle);

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      // Force close mid-race
      handle.forceClose();
      expect(mockPrimaryHandle.forceClose).toHaveBeenCalled();

      // Advance past deadline
      jest.advanceTimersByTime(3001);

      // Secondary should never be called
      expect(mockSecondary.openStream).not.toHaveBeenCalled();
    });

    it('forceClose after deadline but before secondary connect → secondary.forceClose called', () => {
      const mockPrimaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockPrimary.openStream.mockReturnValue(mockPrimaryHandle as TtsStreamHandle);

      const mockSecondaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockSecondary.openStream.mockReturnValue(mockSecondaryHandle as TtsStreamHandle);

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      // Advance past deadline (triggers secondary open)
      jest.advanceTimersByTime(3001);
      expect(mockSecondary.openStream).toHaveBeenCalled();

      // Now force close
      handle.forceClose();
      expect(mockSecondaryHandle.forceClose).toHaveBeenCalled();
    });
  });

  describe('primary sync throw [RT-B]', () => {
    it('primary.openStream throws synchronously → secondary opens immediately', () => {
      mockPrimary.openStream.mockImplementation(() => {
        throw new ServiceUnavailableException('Primary unavailable');
      });

      const mockSecondaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockSecondary.openStream.mockReturnValue(mockSecondaryHandle as TtsStreamHandle);

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      // Let microtask run
      jest.runAllTicks();

      expect(mockSecondary.openStream).toHaveBeenCalled();
      expect((handle as any).getWinnerProvider()).toBe('alibaba-cosyvoice');
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('primary sync throw'),
      );

      handle.forceClose();
    });
  });

  describe('format unsupported [RT-A]', () => {
    it('client requests format, primary times out, secondary does NOT support → fallback aborted', () => {
      const mockPrimaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockPrimary.openStream.mockReturnValue(mockPrimaryHandle as TtsStreamHandle);

      // Secondary does NOT support pcm_s16le
      (mockSecondary.supportsFormat as jest.Mock).mockReturnValue(false);

      let errorThrown: Error | null = null;
      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'pcm_s16le',
        sampleRate: 24000,
      });

      handle.onError((err) => {
        errorThrown = err;
      });

      // Advance past deadline
      jest.advanceTimersByTime(3001);

      // Secondary should NOT be called
      expect(mockSecondary.openStream).not.toHaveBeenCalled();
      expect(errorThrown).toBeDefined();

      handle.forceClose();
    });

    it('client requests format, primary times out, secondary supports → secondary opens with format', () => {
      const mockPrimaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockPrimary.openStream.mockReturnValue(mockPrimaryHandle as TtsStreamHandle);

      const mockSecondaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockSecondary.openStream.mockReturnValue(mockSecondaryHandle as TtsStreamHandle);
      (mockSecondary.supportsFormat as jest.Mock).mockReturnValue(true);

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'pcm_s16le',
        sampleRate: 24000,
      });

      jest.advanceTimersByTime(3001);

      expect(mockSecondary.openStream).toHaveBeenCalledWith(
        expect.objectContaining({
          audioFormat: 'pcm_s16le',
          sampleRate: 24000,
        }),
      );

      handle.forceClose();
    });
  });

  describe('getWinnerProvider [RT-C]', () => {
    it('returns pending before race settles', () => {
      const mockPrimaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockPrimary.openStream.mockReturnValue(mockPrimaryHandle as TtsStreamHandle);

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      expect((handle as any).getWinnerProvider()).toBe('pending');

      handle.forceClose();
    });

    it('returns primary name after primary wins', () => {
      const mockPrimaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockPrimary.openStream.mockReturnValue(mockPrimaryHandle as TtsStreamHandle);

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      const onAudioCallback = (mockPrimaryHandle.onAudio as jest.Mock).mock.calls[0]?.[0];
      onAudioCallback(Buffer.from([0x01]));

      expect((handle as any).getWinnerProvider()).toBe('soniox');

      handle.forceClose();
    });

    it('returns secondary name after promotion', () => {
      const mockPrimaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockPrimary.openStream.mockReturnValue(mockPrimaryHandle as TtsStreamHandle);

      const mockSecondaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockSecondary.openStream.mockReturnValue(mockSecondaryHandle as TtsStreamHandle);

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      jest.advanceTimersByTime(3001);

      expect((handle as any).getWinnerProvider()).toBe('alibaba-cosyvoice');

      handle.forceClose();
    });
  });

  describe('consumer onOpen callback [RT-D]', () => {
    it('fires exactly once on winner determination (not multiple times)', () => {
      const mockPrimaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockPrimary.openStream.mockReturnValue(mockPrimaryHandle as TtsStreamHandle);

      const openCounter = { count: 0 };
      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      handle.onOpen?.(() => {
        openCounter.count++;
      });

      // Emit audio (winner determined)
      const onAudioCallback = (mockPrimaryHandle.onAudio as jest.Mock).mock.calls[0]?.[0];
      onAudioCallback(Buffer.from([0x01]));
      expect(openCounter.count).toBe(1);

      // Emit another audio (should not fire onOpen again)
      onAudioCallback(Buffer.from([0x02]));
      expect(openCounter.count).toBe(1);

      handle.forceClose();
    });

    it('fires once after secondary promotion', () => {
      const mockPrimaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockPrimary.openStream.mockReturnValue(mockPrimaryHandle as TtsStreamHandle);

      const mockSecondaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockSecondary.openStream.mockReturnValue(mockSecondaryHandle as TtsStreamHandle);

      const openCounter = { count: 0 };
      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      handle.onOpen?.(() => {
        openCounter.count++;
      });

      // Advance to deadline (promotes to secondary)
      jest.advanceTimersByTime(3001);

      // Emit audio from secondary
      const secondaryOnAudio = (mockSecondaryHandle.onAudio as jest.Mock).mock.calls[0]?.[0];
      secondaryOnAudio(Buffer.from([0x01]));

      expect(openCounter.count).toBe(1);

      // Emit another audio
      secondaryOnAudio(Buffer.from([0x02]));
      expect(openCounter.count).toBe(1);

      handle.forceClose();
    });
  });

  describe('concurrent streams [RT-M]', () => {
    it('two simultaneous openStream calls promote independently', () => {
      const mockPrimaryHandle1: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };

      const mockPrimaryHandle2: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };

      const mockSecondaryHandle1: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };

      const mockSecondaryHandle2: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };

      let callCount = 0;
      mockPrimary.openStream.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? (mockPrimaryHandle1 as TtsStreamHandle) : (mockPrimaryHandle2 as TtsStreamHandle);
      });

      callCount = 0;
      mockSecondary.openStream.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? (mockSecondaryHandle1 as TtsStreamHandle) : (mockSecondaryHandle2 as TtsStreamHandle);
      });

      // Open two streams
      const handle1 = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      const handle2 = provider.openStream({
        traceId: 'trace-2',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      // Advance both past deadline
      jest.advanceTimersByTime(3001);

      // Both should independently promote
      expect((handle1 as any).getWinnerProvider()).toBe('alibaba-cosyvoice');
      expect((handle2 as any).getWinnerProvider()).toBe('alibaba-cosyvoice');

      handle1.forceClose();
      handle2.forceClose();
    });
  });

  describe('synthesize', () => {
    it('primary resolves in <5s → returns result with provider=soniox', async () => {
      const mockResult: TtsResult = {
        audio: Buffer.from([0x01, 0x02]),
        mimeType: 'audio/mpeg',
      };
      mockPrimary.synthesize.mockResolvedValue(mockResult);

      const result = await provider.synthesize('hello');

      expect(result.provider).toBe('soniox');
      expect(result.audio).toEqual(Buffer.from([0x01, 0x02]));
    });

    it('primary throws → secondary.synthesize called, returns result with provider=alibaba-cosyvoice', async () => {
      mockPrimary.synthesize.mockRejectedValue(new Error('Primary error'));

      const mockResult: TtsResult = {
        audio: Buffer.from([0x03, 0x04]),
        mimeType: 'audio/mpeg',
      };
      mockSecondary.synthesize.mockResolvedValue(mockResult);

      const result = await provider.synthesize('hello');

      expect(mockSecondary.synthesize).toHaveBeenCalled();
      expect(result.provider).toBe('alibaba-cosyvoice');
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('fallback_fired'),
      );
    });

    it('primary times out (>5s) → secondary called', async () => {
      const slowPromise = new Promise<TtsResult>(() => {
        // Never resolves
      });
      mockPrimary.synthesize.mockReturnValue(slowPromise);

      const mockResult: TtsResult = {
        audio: Buffer.from([0x05, 0x06]),
        mimeType: 'audio/mpeg',
      };
      mockSecondary.synthesize.mockResolvedValue(mockResult);

      const resultPromise = provider.synthesize('hello');

      jest.advanceTimersByTime(5001);
      jest.runAllTicks();

      const result = await resultPromise;

      expect(mockSecondary.synthesize).toHaveBeenCalled();
      expect(result.provider).toBe('alibaba-cosyvoice');
    });

    it('primary unavailable → secondary called directly', async () => {
      mockPrimary.isAvailable.mockReturnValue(false);

      const mockResult: TtsResult = {
        audio: Buffer.from([0x07, 0x08]),
        mimeType: 'audio/mpeg',
      };
      mockSecondary.synthesize.mockResolvedValue(mockResult);

      const result = await provider.synthesize('hello');

      expect(mockPrimary.synthesize).not.toHaveBeenCalled();
      expect(mockSecondary.synthesize).toHaveBeenCalled();
      expect(result.provider).toBe('alibaba-cosyvoice');
    });

    it('secondary unavailable → primary called directly (no fallback)', async () => {
      mockSecondary.isAvailable.mockReturnValue(false);

      const mockResult: TtsResult = {
        audio: Buffer.from([0x09, 0x0a]),
        mimeType: 'audio/mpeg',
      };
      mockPrimary.synthesize.mockResolvedValue(mockResult);

      const result = await provider.synthesize('hello');

      expect(mockSecondary.synthesize).not.toHaveBeenCalled();
      expect(result.provider).toBe('soniox');
    });

    it('fallback disabled → primary called even if throws', async () => {
      configService.get.mockImplementation((key: string) => {
        const map: Record<string, unknown> = {
          'ai.ttsFallbackEnabled': false,
          'ai.ttsFallbackTimeoutMs': 3000,
          'ai.alibabaTtsFormat': 'mp3',
        };
        return map[key];
      });

      const fallbackDisabledProvider = new FallbackTtsProvider(
        mockPrimary as any,
        mockSecondary as any,
        configService as never,
      );

      mockPrimary.synthesize.mockRejectedValue(new Error('Primary error'));

      await expect(fallbackDisabledProvider.synthesize('hello')).rejects.toThrow('Primary error');
      expect(mockSecondary.synthesize).not.toHaveBeenCalled();
    });

    it('both unavailable → throws ServiceUnavailable', async () => {
      mockPrimary.isAvailable.mockReturnValue(false);
      mockSecondary.isAvailable.mockReturnValue(false);

      await expect(provider.synthesize('hello')).rejects.toThrow(ServiceUnavailableException);
    });

    it('requested format unsupported by both → throws ServiceUnavailable', async () => {
      mockPrimary.isAvailable.mockReturnValue(false);
      (mockPrimary.supportsFormat as jest.Mock).mockReturnValue(false);
      (mockSecondary.supportsFormat as jest.Mock).mockReturnValue(false);

      await expect(provider.synthesize('hello', { audioFormat: 'mp3' })).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('openStream direct passthrough', () => {
    it('only primary available → returns primary handle directly (no race timer)', () => {
      mockSecondary.isAvailable.mockReturnValue(false);

      const mockPrimaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockPrimary.openStream.mockReturnValue(mockPrimaryHandle as TtsStreamHandle);

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      expect(mockPrimary.openStream).toHaveBeenCalled();
      expect(handle).toBe(mockPrimaryHandle);

      handle.forceClose();
    });

    it('only secondary available → returns secondary handle directly', () => {
      mockPrimary.isAvailable.mockReturnValue(false);

      const mockSecondaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockSecondary.openStream.mockReturnValue(mockSecondaryHandle as TtsStreamHandle);

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      expect(mockSecondary.openStream).toHaveBeenCalled();
      expect(handle).toBe(mockSecondaryHandle);

      handle.forceClose();
    });

    it('both unavailable → throws ServiceUnavailable', () => {
      mockPrimary.isAvailable.mockReturnValue(false);
      mockSecondary.isAvailable.mockReturnValue(false);

      expect(() =>
        provider.openStream({
          traceId: 'trace-1',
          audioFormat: 'mp3',
          sampleRate: 24000,
        }),
      ).toThrow(ServiceUnavailableException);
    });

    it('fallback disabled, secondary unavailable → returns primary handle', () => {
      configService.get.mockImplementation((key: string) => {
        const map: Record<string, unknown> = {
          'ai.ttsFallbackEnabled': false,
          'ai.ttsFallbackTimeoutMs': 3000,
          'ai.alibabaTtsFormat': 'mp3',
        };
        return map[key];
      });

      const fallbackDisabledProvider = new FallbackTtsProvider(
        mockPrimary as any,
        mockSecondary as any,
        configService as never,
      );

      const mockPrimaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockPrimary.openStream.mockReturnValue(mockPrimaryHandle as TtsStreamHandle);

      const handle = fallbackDisabledProvider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      expect(handle).toBe(mockPrimaryHandle);

      handle.forceClose();
    });
  });

  describe('start buffering and replay [RT-D]', () => {
    it('buffered text during race replayed to secondary on promotion', () => {
      const mockPrimaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockPrimary.openStream.mockReturnValue(mockPrimaryHandle as TtsStreamHandle);

      const mockSecondaryHandle: Partial<TtsStreamHandle> = {
        start: jest.fn(),
        forceClose: jest.fn(),
        onAudio: jest.fn(),
        onEnd: jest.fn(),
        onError: jest.fn(),
        onOpen: jest.fn(),
      };
      mockSecondary.openStream.mockReturnValue(mockSecondaryHandle as TtsStreamHandle);

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      // Buffer text during race
      handle.start('hello world');
      expect(mockPrimaryHandle.start).toHaveBeenCalledWith('hello world');

      // Advance to deadline (promote)
      jest.advanceTimersByTime(3001);

      // Verify text replayed to secondary
      expect(mockSecondaryHandle.start).toHaveBeenCalledWith('hello world');

      handle.forceClose();
    });
  });
});

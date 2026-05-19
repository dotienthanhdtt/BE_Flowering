import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { AlibabaTtsProvider } from './alibaba-tts.provider';
import WebSocket from 'ws';

jest.mock('ws');

describe('AlibabaTtsProvider', () => {
  let provider: AlibabaTtsProvider;
  let configService: { get: jest.Mock };
  let MockWebSocket: jest.MockedClass<typeof WebSocket>;
  let wsInstance: {
    on: jest.Mock;
    send: jest.Mock;
    terminate: jest.Mock;
    readyState: number;
  };

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        const map: Record<string, unknown> = {
          'ai.dashscopeApiKey': 'test-dashscope-key',
          'ai.alibabaTtsModel': 'cosyvoice-v3-flash',
          'ai.alibabaTtsVoice': 'longanyang',
          'ai.alibabaTtsFormat': 'mp3',
          'ai.alibabaTtsSampleRate': 24000,
          'ai.alibabaDataInspectionEnabled': false,
          'ai.alibabaInactivityTimeoutMs': 15000,
        };
        return map[key];
      }),
    };

    MockWebSocket = WebSocket as jest.MockedClass<typeof WebSocket>;
    wsInstance = {
      on: jest.fn(),
      send: jest.fn(),
      terminate: jest.fn(),
      readyState: 1, // WebSocket.OPEN
    };
    MockWebSocket.mockImplementation(() => wsInstance as never);

    provider = new AlibabaTtsProvider(configService as never);

    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('isAvailable', () => {
    it('returns true when DASHSCOPE_API_KEY configured', () => {
      expect(provider.isAvailable()).toBe(true);
    });

    it('returns false when DASHSCOPE_API_KEY missing', () => {
      configService.get.mockReturnValue(undefined);
      const empty = new AlibabaTtsProvider(configService as never);
      expect(empty.isAvailable()).toBe(false);
    });
  });

  describe('supportsFormat', () => {
    it('returns true for supported formats', () => {
      expect(provider.supportsFormat('mp3')).toBe(true);
      expect(provider.supportsFormat('wav')).toBe(true);
      expect(provider.supportsFormat('pcm')).toBe(true);
      expect(provider.supportsFormat('pcm_s16le')).toBe(true);
      expect(provider.supportsFormat('opus')).toBe(true);
    });

    it('returns false for unsupported formats', () => {
      expect(provider.supportsFormat('flac')).toBe(false);
      expect(provider.supportsFormat('ogg')).toBe(false);
    });
  });

  describe('openStream', () => {
    it('throws ServiceUnavailable when key missing', () => {
      configService.get.mockReturnValue(undefined);
      const empty = new AlibabaTtsProvider(configService as never);

      expect(() => empty.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      })).toThrow(ServiceUnavailableException);
    });

    it('throws on unsupported audioFormat', () => {
      expect(() => provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'flac',
        sampleRate: 24000,
      })).toThrow('unsupported audioFormat');
    });

    it('throws on unsupported sampleRate', () => {
      expect(() => provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 12345,
      })).toThrow('unsupported sampleRate');
    });

    it('connects and sends run-task with normalized pcm_s16le format', () => {
      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'pcm_s16le',
        sampleRate: 24000,
      });

      expect(MockWebSocket).toHaveBeenCalledWith(
        'wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-dashscope-key',
          }),
        }),
      );

      const openCallback = wsInstance.on.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as (...args: any[]) => void;
      openCallback?.();

      const sendCall = wsInstance.send.mock.calls[0][0];
      const msg = JSON.parse(sendCall);
      expect(msg.header.action).toBe('run-task');
      expect(msg.payload.parameters.format).toBe('pcm'); // normalized from pcm_s16le
      expect(msg.payload.parameters.sample_rate).toBe(24000);

      handle.forceClose();
    });
  });

  describe('happy path stream lifecycle', () => {
    it('opens, sends run-task, buffers start before task-started, emits audio, completes', async () => {
      const audioChunks: Buffer[] = [];
      let endCompleted = false;
      let endCalled = false;

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      handle.onAudio((chunk) => audioChunks.push(chunk));
      handle.onEnd((completed) => {
        endCompleted = completed;
        endCalled = true;
      });

      // Simulate WS open
      const openCallback = wsInstance.on.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as (...args: any[]) => void;
      openCallback?.();

      // Verify run-task sent
      expect(wsInstance.send).toHaveBeenCalled();
      const runTaskMsg = JSON.parse(wsInstance.send.mock.calls[0][0]);
      expect(runTaskMsg.header.action).toBe('run-task');

      // Buffer text before task-started
      handle.start('hello world');
      expect(wsInstance.send).toHaveBeenCalledTimes(1); // only run-task

      // Simulate task-started
      const messageCallback = wsInstance.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1] as (...args: any[]) => void;
      messageCallback?.(
        Buffer.from(JSON.stringify({ header: { event: 'task-started' } })),
        false,
      );

      // Verify continue-task and finish-task sent with buffered text
      expect(wsInstance.send).toHaveBeenCalledTimes(3); // run-task + continue-task + finish-task
      const continueMsg = JSON.parse(wsInstance.send.mock.calls[1][0]);
      expect(continueMsg.header.action).toBe('continue-task');
      expect(continueMsg.payload.input.text).toBe('hello world');

      // Simulate audio chunk
      messageCallback?.(Buffer.from([0x01, 0x02, 0x03]), true);
      expect(audioChunks).toHaveLength(1);
      expect(audioChunks[0]).toEqual(Buffer.from([0x01, 0x02, 0x03]));

      // Simulate task-finished
      messageCallback?.(
        Buffer.from(JSON.stringify({ header: { event: 'task-finished' } })),
        false,
      );

      expect(endCalled).toBe(true);
      expect(endCompleted).toBe(true);

      handle.forceClose();
    });
  });

  describe('error handling', () => {
    it('fires onError with sanitized task-failed event', async () => {
      let errorThrown: Error | null = null;

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      handle.onError((err) => {
        errorThrown = err;
      });

      const openCallback = wsInstance.on.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as (...args: any[]) => void;
      openCallback?.();

      const messageCallback = wsInstance.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1] as (...args: any[]) => void;

      // Simulate task-failed with error message containing API key
      messageCallback?.(
        Buffer.from(
          JSON.stringify({
            header: {
              event: 'task-failed',
              error_code: 'AUTH_ERROR',
              error_message: 'auth failed for Bearer sk-secret-key',
            },
          }),
        ),
        false,
      );

      expect(errorThrown).toBeDefined();
      expect((errorThrown as unknown as Error)?.message).toContain('task-failed');
      expect((errorThrown as unknown as Error)?.message).not.toContain('sk-secret-key');
      expect((errorThrown as unknown as Error)?.message).not.toContain('Bearer sk-secret-key');

      handle.forceClose();
    });

    it('sanitizes both Bearer token AND configured API key in error messages', () => {
      let errorThrown: Error | null = null;

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      handle.onError((err) => {
        errorThrown = err;
      });

      const openCallback = wsInstance.on.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as (...args: any[]) => void;
      openCallback?.();

      const messageCallback = wsInstance.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1] as (...args: any[]) => void;

      // Error message contains both Bearer token AND configured key
      messageCallback?.(
        Buffer.from(
          JSON.stringify({
            header: {
              event: 'task-failed',
              error_code: 'AUTH',
              error_message: 'auth failed Bearer sk-xxx and key test-dashscope-key not found',
            },
          }),
        ),
        false,
      );

      expect((errorThrown as unknown as Error)?.message).not.toContain('Bearer sk-xxx');
      expect((errorThrown as unknown as Error)?.message).not.toContain('test-dashscope-key');
    });

    it('fires onEnd(false) on premature WS close', async () => {
      let endCompleted = false;
      let endCalled = false;

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      handle.onEnd((completed) => {
        endCompleted = completed;
        endCalled = true;
      });

      const openCallback = wsInstance.on.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as (...args: any[]) => void;
      openCallback?.();

      // Simulate close before task-finished
      const closeCallback = wsInstance.on.mock.calls.find(
        (call) => call[0] === 'close',
      )?.[1] as (...args: any[]) => void;
      closeCallback?.(1000);

      expect(endCalled).toBe(true);
      expect(endCompleted).toBe(false);

      handle.forceClose();
    });
  });

  describe('inactivity timeout [RT-F]', () => {
    it('fires onError with timeout message after 15s no message', async () => {
      let errorThrown: Error | null = null;

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      handle.onError((err) => {
        errorThrown = err;
      });

      const openCallback = wsInstance.on.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as (...args: any[]) => void;
      openCallback?.();

      jest.advanceTimersByTime(15000);

      expect(errorThrown).toBeDefined();
      expect((errorThrown as unknown as Error)?.message).toContain('inactivity timeout');
      expect(wsInstance.terminate).toHaveBeenCalled();

      handle.forceClose();
    });

    it('resets timer on each incoming message', () => {
      let errorThrown: Error | null = null;

      const handle = provider.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      handle.onError((err) => {
        errorThrown = err;
      });

      const openCallback = wsInstance.on.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as (...args: any[]) => void;
      openCallback?.();

      const messageCallback = wsInstance.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1] as (...args: any[]) => void;

      // Advance 14s (under timeout)
      jest.advanceTimersByTime(14000);
      expect(errorThrown).toBeNull();

      // Receive message (resets timer)
      messageCallback?.(Buffer.from([0x01, 0x02]), true);

      // Advance another 14s (still under 15s since reset)
      jest.advanceTimersByTime(14000);
      expect(errorThrown).toBeNull();

      // Advance 2s more (now 1s past reset + 14s = 15s total since reset)
      jest.advanceTimersByTime(2000);
      expect(errorThrown).toBeDefined();
      expect((errorThrown as unknown as Error)?.message).toContain('inactivity timeout');

      handle.forceClose();
    });
  });

  describe('synthesize', () => {
    it('returns concatenated audio Buffer on happy path', async () => {
      const result = new Promise<{ audio: Buffer; mimeType: string }>((resolve, reject) => {
        provider.synthesize('hello').then(resolve).catch(reject);
      });

      const openCallback = wsInstance.on.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as (...args: any[]) => void;
      openCallback?.();

      const messageCallback = wsInstance.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1] as (...args: any[]) => void;

      // Simulate task-started
      messageCallback?.(
        Buffer.from(JSON.stringify({ header: { event: 'task-started' } })),
        false,
      );

      // Simulate audio chunks
      messageCallback?.(Buffer.from([0x01, 0x02]), true);
      messageCallback?.(Buffer.from([0x03, 0x04]), true);

      // Simulate task-finished
      messageCallback?.(
        Buffer.from(JSON.stringify({ header: { event: 'task-finished' } })),
        false,
      );

      const res = await result;
      expect(res.audio).toEqual(Buffer.from([0x01, 0x02, 0x03, 0x04]));
      expect(res.mimeType).toBe('audio/mpeg'); // mp3
    });

    it('rejects and force-closes on error', async () => {
      const result = provider.synthesize('hello').catch((err) => err);

      const openCallback = wsInstance.on.mock.calls.find(
        (call) => call[0] === 'open',
      )?.[1] as (...args: any[]) => void;
      openCallback?.();

      const messageCallback = wsInstance.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1] as (...args: any[]) => void;

      // Simulate task-failed
      messageCallback?.(
        Buffer.from(
          JSON.stringify({
            header: {
              event: 'task-failed',
              error_code: 'FAIL',
              error_message: 'error',
            },
          }),
        ),
        false,
      );

      const err = await result;
      expect(err).toBeInstanceOf(BadGatewayException);
      expect(wsInstance.terminate).toHaveBeenCalled();
    });

    it('throws ServiceUnavailable when key missing', async () => {
      configService.get.mockReturnValue(undefined);
      const empty = new AlibabaTtsProvider(configService as never);

      await expect(empty.synthesize('hello')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('dataInspectionEnabled header [RT-I]', () => {
    it('does NOT include X-DashScope-DataInspection header when disabled (default)', () => {
      configService.get.mockImplementation((key: string) => {
        const map: Record<string, unknown> = {
          'ai.dashscopeApiKey': 'test-key',
          'ai.alibabaTtsModel': 'cosyvoice-v3-flash',
          'ai.alibabaTtsVoice': 'longanyang',
          'ai.alibabaTtsFormat': 'mp3',
          'ai.alibabaTtsSampleRate': 24000,
          'ai.alibabaDataInspectionEnabled': false,
          'ai.alibabaInactivityTimeoutMs': 15000,
        };
        return map[key];
      });

      const p = new AlibabaTtsProvider(configService as never);
      p.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      const options = MockWebSocket.mock.calls[0][1] as { headers?: Record<string, string> };
      expect(options?.headers).not.toHaveProperty('X-DashScope-DataInspection');
    });

    it('includes X-DashScope-DataInspection header when enabled', () => {
      configService.get.mockImplementation((key: string) => {
        const map: Record<string, unknown> = {
          'ai.dashscopeApiKey': 'test-key',
          'ai.alibabaTtsModel': 'cosyvoice-v3-flash',
          'ai.alibabaTtsVoice': 'longanyang',
          'ai.alibabaTtsFormat': 'mp3',
          'ai.alibabaTtsSampleRate': 24000,
          'ai.alibabaDataInspectionEnabled': true,
          'ai.alibabaInactivityTimeoutMs': 15000,
        };
        return map[key];
      });

      const p = new AlibabaTtsProvider(configService as never);
      p.openStream({
        traceId: 'trace-1',
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      const options = MockWebSocket.mock.calls[0][1] as { headers?: Record<string, string> };
      expect(options?.headers?.['X-DashScope-DataInspection']).toBe('enable');
    });
  });
});

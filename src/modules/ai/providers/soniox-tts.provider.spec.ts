import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { SonioxTtsProvider } from './soniox-tts.provider';

describe('SonioxTtsProvider', () => {
  let provider: SonioxTtsProvider;
  let configService: { get: jest.Mock };
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    configService = { get: jest.fn() };
    configService.get.mockImplementation((key: string) => {
      const map: Record<string, unknown> = {
        'ai.sonioxApiKey': 'test-key',
        'ai.sonioxTtsModel': 'tts-rt-v1',
        'ai.sonioxTtsVoice': 'Adrian',
        'ai.sonioxTtsAudioFormat': 'mp3',
        'ai.sonioxTtsSampleRate': 24000,
      };
      return map[key];
    });
    provider = new SonioxTtsProvider(configService as never);
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('isAvailable', () => {
    it('returns true when api key set', () => {
      expect(provider.isAvailable()).toBe(true);
    });

    it('returns false when api key missing', () => {
      configService.get.mockReturnValue(undefined);
      const empty = new SonioxTtsProvider(configService as never);
      expect(empty.isAvailable()).toBe(false);
    });
  });

  describe('synthesize', () => {
    it('returns audio Buffer + audio/mpeg on success', async () => {
      const audioBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => audioBytes.buffer,
      } as never);

      const result = await provider.synthesize('hello');

      expect(result.mimeType).toBe('audio/mpeg');
      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.audio.length).toBe(4);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://tts-rt.soniox.com/tts',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        }),
      );
      const body = JSON.parse((fetchSpy.mock.calls[0][1] as { body: string }).body);
      expect(body).toMatchObject({
        model: 'tts-rt-v1',
        voice: 'Adrian',
        audio_format: 'mp3',
        text: 'hello',
      });
    });

    it('throws BadGateway on non-2xx', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'invalid key',
      } as never);

      await expect(provider.synthesize('hi')).rejects.toThrow(BadGatewayException);
    });

    it('throws ServiceUnavailable when api key missing', async () => {
      configService.get.mockReturnValue(undefined);
      const empty = new SonioxTtsProvider(configService as never);

      await expect(empty.synthesize('hi')).rejects.toThrow(ServiceUnavailableException);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('honors per-call voice override', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array().buffer,
      } as never);

      await provider.synthesize('hi', { voice: 'CustomVoice' });

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as { body: string }).body);
      expect(body.voice).toBe('CustomVoice');
    });
  });
});

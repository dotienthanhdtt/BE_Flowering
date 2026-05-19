import { buildFinalizedWavHeader, buildStreamingWavHeader, WavPcmFormat } from './wav-header';

const fmt: WavPcmFormat = { sampleRate: 24000, channels: 1, bitsPerSample: 16 };

describe('wav-header', () => {
  describe('buildStreamingWavHeader', () => {
    const header = buildStreamingWavHeader(fmt);

    it('produces a 44-byte RIFF/WAVE/fmt/data canonical header', () => {
      expect(header.byteLength).toBe(44);
      expect(header.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(header.subarray(8, 12).toString('ascii')).toBe('WAVE');
      expect(header.subarray(12, 16).toString('ascii')).toBe('fmt ');
      expect(header.subarray(36, 40).toString('ascii')).toBe('data');
    });

    it('encodes the requested PCM format in the fmt chunk', () => {
      expect(header.readUInt32LE(16)).toBe(16); // fmt chunk size
      expect(header.readUInt16LE(20)).toBe(1); // PCM
      expect(header.readUInt16LE(22)).toBe(fmt.channels);
      expect(header.readUInt32LE(24)).toBe(fmt.sampleRate);
      // byteRate = sampleRate * channels * bytesPerSample
      expect(header.readUInt32LE(28)).toBe(fmt.sampleRate * fmt.channels * 2);
      expect(header.readUInt16LE(32)).toBe(fmt.channels * 2); // blockAlign
      expect(header.readUInt16LE(34)).toBe(fmt.bitsPerSample);
    });

    // Regression: ExoPlayer's WavExtractor adds the 44-byte data offset to the
    // declared data size when computing end-of-data. With 0xFFFFFFFF this
    // overflows past int32 (logged as `Data exceeds input length: 4294967339`)
    // and STATE_ENDED never fires. 0x7FFFFFFF stays inside int32 math.
    it('uses 0x7FFFFFFF (not 0xFFFFFFFF) for streaming chunk sizes', () => {
      const dataSize = header.readUInt32LE(40);
      const riffSize = header.readUInt32LE(4);
      expect(dataSize).toBe(0x7fffffff);
      expect(riffSize).toBe(0x7fffffff);
      expect(dataSize).not.toBe(0xffffffff);
      // dataChunkOffset (44) + dataSize must NOT overflow int32, which is
      // exactly what triggered the Android decoder stall.
      expect(44 + dataSize).toBeLessThanOrEqual(0x7fffffff + 44);
      expect(44 + dataSize).toBeLessThan(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('buildFinalizedWavHeader', () => {
    it('writes the exact data size for cached/persisted audio', () => {
      const pcmBytes = 465600;
      const header = buildFinalizedWavHeader(fmt, pcmBytes);
      expect(header.byteLength).toBe(44);
      expect(header.readUInt32LE(40)).toBe(pcmBytes);
      // RIFF size = 36 + dataSize per WAV spec.
      expect(header.readUInt32LE(4)).toBe(36 + pcmBytes);
    });
  });
});

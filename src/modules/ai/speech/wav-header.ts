// Build a 44-byte canonical RIFF/WAVE header for PCM s16le audio.
//
// Two modes:
// - streaming(): emits 0xFFFFFFFF for the chunk-size fields so the client's
//   decoder accepts the header without knowing total length yet. The actual
//   data size is irrelevant when the connection later closes; the player
//   stops at the source EOF.
// - finalized(): writes the exact data size — use after the full PCM buffer
//   is known (cache persistence).
export interface WavPcmFormat {
  sampleRate: number;
  channels: number; // 1 = mono, 2 = stereo
  bitsPerSample: number; // 16 for s16le
}

function writeHeader(fmt: WavPcmFormat, dataSize: number, riffSize: number): Buffer {
  const { sampleRate, channels, bitsPerSample } = fmt;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(riffSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
}

// Header used at the start of a live PCM stream. Max-size sentinels let the
// player accept the stream without knowing total length — playback ends when
// the underlying source closes.
export function buildStreamingWavHeader(fmt: WavPcmFormat): Buffer {
  return writeHeader(fmt, 0xffffffff, 0xffffffff);
}

// Header used when wrapping a complete PCM buffer for persistence.
export function buildFinalizedWavHeader(fmt: WavPcmFormat, pcmBytes: number): Buffer {
  return writeHeader(fmt, pcmBytes, 36 + pcmBytes);
}

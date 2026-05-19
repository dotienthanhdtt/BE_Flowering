// Build a 44-byte canonical RIFF/WAVE header for PCM s16le audio.
//
// Two modes:
// - streaming(): emits a large finite chunk-size upper bound so the decoder
//   accepts the header without knowing total length yet; playback ends when
//   the underlying source signals EOF. See buildStreamingWavHeader for the
//   exact value and the ExoPlayer-specific reason it's not 0xFFFFFFFF.
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

// Header used at the start of a live PCM stream. We don't know the final
// length yet, so we declare a large-but-finite upper bound (~1h of audio at
// any supported sample rate; safely above CosyVoice's per-request limit and
// our own 60s max-duration cap).
//
// The "obvious" choice would be 0xFFFFFFFF — the conventional streaming-WAV
// sentinel — but Android Media3 ExoPlayer's WavExtractor adds the data-chunk
// offset (44) when computing the declared end position, overflows past int32
// limits, logs `Data exceeds input length: 4294967339, <real>`, and then
// refuses to fire `STATE_ENDED` even after the HTTP-like source signals EOF.
// Result on Android: audio plays to completion but the player processing
// state stalls in `ready`/`buffering` forever, which our streaming player
// then waits on, blocking the next utterance's playback.
//
// 0x7FFFFFFF (~2.1GB ≈ many hours of 24kHz s16le mono) keeps WavExtractor's
// internal end-of-data math inside int32, while still being larger than any
// real audio we'll produce so the decoder reads bytes until the source
// closes rather than truncating early.
const STREAMING_WAV_DATA_SIZE = 0x7fffffff;
const STREAMING_WAV_RIFF_SIZE = 0x7fffffff;

export function buildStreamingWavHeader(fmt: WavPcmFormat): Buffer {
  return writeHeader(fmt, STREAMING_WAV_DATA_SIZE, STREAMING_WAV_RIFF_SIZE);
}

// Header used when wrapping a complete PCM buffer for persistence.
export function buildFinalizedWavHeader(fmt: WavPcmFormat, pcmBytes: number): Buffer {
  return writeHeader(fmt, pcmBytes, 36 + pcmBytes);
}

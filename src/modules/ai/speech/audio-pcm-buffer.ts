export const SAMPLE_RATE = 16000;
export const BYTES_PER_SAMPLE = 2; // 16-bit
export const MAX_DURATION_SEC = 180; // 3 min
export const MAX_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * MAX_DURATION_SEC; // ~5.76 MB

export class AudioPcmBuffer {
  private readonly chunks: Buffer[] = [];
  private totalBytes = 0;

  push(chunk: Buffer): void {
    if (this.totalBytes + chunk.byteLength > MAX_BYTES) {
      throw new Error(`Audio buffer overflow (max ${MAX_BYTES} bytes)`);
    }
    this.chunks.push(chunk);
    this.totalBytes += chunk.byteLength;
  }

  get byteLength(): number {
    return this.totalBytes;
  }

  /** Concatenate buffered PCM and prepend a 44-byte RIFF/WAV header. */
  toWav(): Buffer {
    const pcm = Buffer.concat(this.chunks);
    const numChannels = 1;
    const byteRate = SAMPLE_RATE * numChannels * BYTES_PER_SAMPLE;
    const blockAlign = numChannels * BYTES_PER_SAMPLE;
    const dataSize = pcm.byteLength;
    const header = Buffer.alloc(44);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // PCM chunk size
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34); // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcm]);
  }
}

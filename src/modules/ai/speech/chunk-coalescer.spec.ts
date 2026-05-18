import { createChunkCoalescer } from './chunk-coalescer';

describe('createChunkCoalescer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('flushes the first chunk immediately', () => {
    const flushes: Buffer[] = [];
    const c = createChunkCoalescer({
      maxBytes: 64 * 1024,
      maxMs: 20,
      onFlush: (b) => flushes.push(b),
    });
    c.onData(Buffer.from('first'));
    expect(flushes).toHaveLength(1);
    expect(flushes[0].toString()).toBe('first');
  });

  it('coalesces subsequent small chunks within the time window', () => {
    const flushes: Buffer[] = [];
    const c = createChunkCoalescer({
      maxBytes: 64 * 1024,
      maxMs: 20,
      onFlush: (b) => flushes.push(b),
    });
    c.onData(Buffer.from('A')); // first → immediate
    c.onData(Buffer.from('B'));
    c.onData(Buffer.from('C'));
    expect(flushes).toHaveLength(1);
    jest.advanceTimersByTime(20);
    expect(flushes).toHaveLength(2);
    expect(flushes[1].toString()).toBe('BC');
  });

  it('flushes early when the size threshold is reached', () => {
    const flushes: Buffer[] = [];
    const c = createChunkCoalescer({
      maxBytes: 4,
      maxMs: 1000,
      onFlush: (b) => flushes.push(b),
    });
    c.onData(Buffer.from('xx')); // first
    c.onData(Buffer.from('ab'));
    c.onData(Buffer.from('cd')); // bytes hits 4 → flush
    expect(flushes).toHaveLength(2);
    expect(flushes[1].toString()).toBe('abcd');
  });

  it('flushes pending bytes on end', () => {
    const flushes: Buffer[] = [];
    const c = createChunkCoalescer({
      maxBytes: 64 * 1024,
      maxMs: 20,
      onFlush: (b) => flushes.push(b),
    });
    c.onData(Buffer.from('first'));
    c.onData(Buffer.from('tail'));
    c.onEnd();
    expect(flushes).toHaveLength(2);
    expect(flushes[1].toString()).toBe('tail');
  });

  it('clears pending timer + buffer on error', () => {
    const flushes: Buffer[] = [];
    const c = createChunkCoalescer({
      maxBytes: 64 * 1024,
      maxMs: 20,
      onFlush: (b) => flushes.push(b),
    });
    c.onData(Buffer.from('first'));
    c.onData(Buffer.from('lost'));
    c.onError();
    jest.advanceTimersByTime(50);
    expect(flushes).toHaveLength(1); // only the first immediate flush
    expect(c.isActive()).toBe(false);
  });

  it('drops data when shouldAccept returns false', () => {
    const flushes: Buffer[] = [];
    let accepting = true;
    const c = createChunkCoalescer({
      maxBytes: 64 * 1024,
      maxMs: 20,
      shouldAccept: () => accepting,
      onFlush: (b) => flushes.push(b),
    });
    c.onData(Buffer.from('first'));
    accepting = false;
    c.onData(Buffer.from('dropped'));
    jest.advanceTimersByTime(20);
    expect(flushes).toHaveLength(1);
  });

  it('ignores data after end', () => {
    const flushes: Buffer[] = [];
    const c = createChunkCoalescer({
      maxBytes: 64 * 1024,
      maxMs: 20,
      onFlush: (b) => flushes.push(b),
    });
    c.onData(Buffer.from('first'));
    c.onEnd();
    c.onData(Buffer.from('late'));
    expect(flushes).toHaveLength(1);
  });
});

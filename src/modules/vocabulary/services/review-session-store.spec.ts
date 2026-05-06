import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReviewSessionStore } from './review-session-store';

describe('ReviewSessionStore', () => {
  let store: ReviewSessionStore;

  beforeEach(() => {
    store = new ReviewSessionStore();
  });

  afterEach(() => {
    store.onModuleDestroy();
    jest.useRealTimers();
  });

  it('creates session with UUID and cardIds', () => {
    const s = store.create('u1', ['v1', 'v2']);
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.userId).toBe('u1');
    expect(s.cardIds).toEqual(['v1', 'v2']);
    expect(s.ratings.size).toBe(0);
  });

  it('returns session for owner', () => {
    const s = store.create('u1', ['v1']);
    expect(store.get(s.id, 'u1').id).toBe(s.id);
  });

  it('throws ForbiddenException for non-owner', () => {
    const s = store.create('u1', ['v1']);
    expect(() => store.get(s.id, 'u2')).toThrow(ForbiddenException);
  });

  it('throws NotFoundException for unknown session', () => {
    expect(() => store.get('nope', 'u1')).toThrow(NotFoundException);
  });

  it('throws NotFoundException for expired session', () => {
    jest.useFakeTimers();
    const s = store.create('u1', ['v1']);
    jest.advanceTimersByTime(60 * 60 * 1000 + 1); // 1h + 1ms
    expect(() => store.get(s.id, 'u1')).toThrow(NotFoundException);
  });

  it('sweeps expired sessions', () => {
    jest.useFakeTimers();
    const s1 = store.create('u1', ['v1']);
    jest.advanceTimersByTime(60 * 60 * 1000 + 1);
    store.sweep();
    expect(() => store.get(s1.id, 'u1')).toThrow(NotFoundException);
  });

  it('keeps non-expired sessions on sweep', () => {
    jest.useFakeTimers();
    const s = store.create('u1', ['v1']);
    jest.advanceTimersByTime(30 * 60 * 1000); // 30m
    store.sweep();
    expect(store.get(s.id, 'u1').id).toBe(s.id);
  });

  it('deletes session', () => {
    const s = store.create('u1', ['v1']);
    store.delete(s.id);
    expect(() => store.get(s.id, 'u1')).toThrow(NotFoundException);
  });

  it('starts the sweep timer on init and clears on destroy', () => {
    jest.useFakeTimers();
    const setSpy = jest.spyOn(global, 'setInterval');
    const clearSpy = jest.spyOn(global, 'clearInterval');
    store.onModuleInit();
    expect(setSpy).toHaveBeenCalled();
    store.onModuleDestroy();
    expect(clearSpy).toHaveBeenCalled();
  });
});

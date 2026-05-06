import { applyLeitner, LEITNER_INTERVALS_DAYS } from './leitner';

describe('applyLeitner', () => {
  const NOW = new Date('2026-04-12T00:00:00.000Z');
  const DAY = 86_400_000;

  it('promotes box 1 → 2 with +3 days on correct', () => {
    const { box, dueAt } = applyLeitner(1, true, NOW);
    expect(box).toBe(2);
    expect(dueAt.getTime()).toBe(NOW.getTime() + 3 * DAY);
  });

  it('promotes box 2 → 3 with +7 days on correct', () => {
    const { box, dueAt } = applyLeitner(2, true, NOW);
    expect(box).toBe(3);
    expect(dueAt.getTime()).toBe(NOW.getTime() + 7 * DAY);
  });

  it('promotes box 3 → 4 with +14 days on correct', () => {
    const { box, dueAt } = applyLeitner(3, true, NOW);
    expect(box).toBe(4);
    expect(dueAt.getTime()).toBe(NOW.getTime() + 14 * DAY);
  });

  it('promotes box 4 → 5 with +30 days on correct', () => {
    const { box, dueAt } = applyLeitner(4, true, NOW);
    expect(box).toBe(5);
    expect(dueAt.getTime()).toBe(NOW.getTime() + 30 * DAY);
  });

  it('caps at box 5 with +30 days on correct at box 5', () => {
    const { box, dueAt } = applyLeitner(5, true, NOW);
    expect(box).toBe(5);
    expect(dueAt.getTime()).toBe(NOW.getTime() + 30 * DAY);
  });

  it.each([1, 2, 3, 4, 5])('resets box %d to 1 with +1 day on wrong', (current) => {
    const { box, dueAt } = applyLeitner(current, false, NOW);
    expect(box).toBe(1);
    expect(dueAt.getTime()).toBe(NOW.getTime() + 1 * DAY);
  });

  it('uses provided `now` deterministically', () => {
    const custom = new Date('2030-01-01T12:00:00.000Z');
    const { dueAt } = applyLeitner(1, true, custom);
    expect(dueAt.getTime()).toBe(custom.getTime() + 3 * DAY);
  });

  it('defaults `now` to real clock when not provided', () => {
    const before = Date.now();
    const { dueAt } = applyLeitner(1, false);
    const after = Date.now();
    const delta = dueAt.getTime() - 1 * DAY;
    expect(delta).toBeGreaterThanOrEqual(before);
    expect(delta).toBeLessThanOrEqual(after);
  });

  it('exposes correct interval table', () => {
    expect(LEITNER_INTERVALS_DAYS).toEqual({ 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 });
  });
});

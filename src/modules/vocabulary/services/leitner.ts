/**
 * Pure Leitner 5-box transition logic.
 *
 * Intervals (days-until-next-review) are keyed by the NEW box after transition:
 *   box 1 → 2: +3 days
 *   box 2 → 3: +7 days
 *   box 3 → 4: +14 days
 *   box 4 → 5: +30 days
 *   box 5 → 5: +30 days (cap)
 *   any → 1 on wrong: +1 day
 */
export const LEITNER_INTERVALS_DAYS: Record<number, number> = {
  1: 1,
  2: 3,
  3: 7,
  4: 14,
  5: 30,
};

export const MAX_BOX = 5;
export const MIN_BOX = 1;
const MS_PER_DAY = 86_400_000;

export interface LeitnerTransition {
  box: number;
  dueAt: Date;
}

/**
 * Compute the next Leitner box + due-at given the current box and rating.
 * `now` is injectable for deterministic tests.
 */
export function applyLeitner(
  currentBox: number,
  correct: boolean,
  now: Date = new Date(),
): LeitnerTransition {
  const newBox = correct ? Math.min(currentBox + 1, MAX_BOX) : MIN_BOX;
  const intervalDays = correct ? LEITNER_INTERVALS_DAYS[newBox] : 1;
  const dueAt = new Date(now.getTime() + intervalDays * MS_PER_DAY);
  return { box: newBox, dueAt };
}

// Spaced-repetition scheduling.
//
// A review advances through `intervals` one stage at a time. Past the last
// interval it repeats the final one, so mature problems keep a long cadence
// instead of falling off the schedule entirely.

import { addDays } from './time.js';

export const DEFAULT_INTERVALS = [1, 3, 7, 14, 30, 60, 120];

export function intervalAt(intervals, stage) {
  const list = intervals && intervals.length ? intervals : DEFAULT_INTERVALS;
  return list[Math.min(Math.max(stage, 0), list.length - 1)];
}

export function scheduleFirst(slug, todayK, intervals) {
  return {
    slug,
    stage: 0,
    dueOn: addDays(todayK, intervalAt(intervals, 0)),
    lastReviewedAt: null,
    history: [],
  };
}

/**
 * `done`   -> graduate to the next interval
 * `snooze` -> push a day, keep the stage (didn't get to it, didn't fail it)
 * `again`  -> forgot it; back to stage 0
 */
export function applyReview(review, action, todayK, intervals) {
  const history = [...(review.history || []), { action, on: todayK }].slice(-50);

  if (action === 'done') {
    const stage = review.stage + 1;
    return { ...review, stage, dueOn: addDays(todayK, intervalAt(intervals, stage)), lastReviewedAt: todayK, history };
  }
  if (action === 'snooze') {
    return { ...review, dueOn: addDays(todayK, 1), history };
  }
  if (action === 'again') {
    return { ...review, stage: 0, dueOn: addDays(todayK, intervalAt(intervals, 0)), lastReviewedAt: todayK, history };
  }
  return review;
}

/** Everything due on or before `key` — overdue items included, oldest first. */
export function dueBy(reviews, key) {
  return Object.values(reviews)
    .filter((r) => r.dueOn <= key)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.slug.localeCompare(b.slug));
}

/** { "YYYY-MM-DD": count } of items scheduled exactly on each day. */
export function dueCountsByDay(reviews) {
  const out = {};
  for (const r of Object.values(reviews)) {
    out[r.dueOn] = (out[r.dueOn] || 0) + 1;
  }
  return out;
}

export function parseIntervals(text) {
  const list = String(text)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 3650)
    .map((n) => Math.round(n));
  return list.length ? [...new Set(list)].sort((a, b) => a - b) : DEFAULT_INTERVALS;
}

// Spaced-repetition scheduling.
//
// A review advances through `intervals` one stage at a time. Past the last
// interval it repeats the final one, so mature problems keep a long cadence
// instead of falling off the schedule entirely.

import { addDays } from './time.js';

// The ladder. Growth is roughly x2 per rung, which is what the expanding-gap
// literature keeps landing on: the useful gap is a sizeable fraction of how
// long you want to remember something, so each successful recall buys a much
// longer wait. Past a year the evidence thins out badly — the long-retention
// studies are few and small — so the ladder stops at 365 and repeats it rather
// than inventing rungs nobody has measured.
export const DEFAULT_INTERVALS = [1, 3, 7, 14, 30, 60, 120, 240, 365];

/** Delay presets offered in the UI, alongside a free-text number of days. */
export const DELAY_PRESETS = [
  { days: 1, label: 'Tomorrow' },
  { days: 2, label: 'In 2 days' },
  { days: 3, label: 'In 3 days' },
  { days: 7, label: 'In a week' },
];

const MAX_DELAY = 3650;

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
    needsReview: false,
    history: [],
  };
}

/** Whole days for a delay, or null when the input isn't usable. */
export function normaliseDelay(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_DELAY) : null;
}

// Pushing is always measured from whichever is later, today or the existing due
// date. Anchoring on today alone would let "delay a day" on something due next
// week pull it *forward* to tomorrow.
function pushFrom(review, todayK) {
  return review.dueOn && review.dueOn > todayK ? review.dueOn : todayK;
}

/**
 * `done`   -> graduate to the next interval
 * `ace`    -> "nailed it": skip a whole cycle. The stage jumps two rungs, but
 *             the next review is only one rung away — from the 3-day rung you
 *             become a 14-day problem due in 7 days, not in 14. Confidence
 *             should move the ladder, not blank the problem out for a month.
 * `again`  -> forgot it; back to stage 0
 * `delay`  -> not today; push `opts.days` (default 1) without touching the stage
 * `snooze` -> `delay` by a single day, kept as its own name for the UI
 * `skip`   -> skip this cycle: push a whole interval at the current stage,
 *             which is not the same as reviewing it — the stage doesn't move
 *             and it doesn't count as reviewed
 * `flag` / `unflag` -> mark "needs review", which surfaces it in the queue
 *             regardless of its due date
 * `retire` -> stop scheduling it: off the calendar and out of the queue, but
 *             still solved and still counted everywhere else
 * `restore` -> put it back on the schedule
 *
 * @param {object} review
 * @param {'done'|'ace'|'again'|'delay'|'snooze'|'skip'|'flag'|'unflag'} action
 * @param {string} todayK
 * @param {number[]} intervals
 * @param {{days?:number}} [opts]
 */
export function applyReview(review, action, todayK, intervals, opts = {}) {
  const log = (entry) => [...(review.history || []), { on: todayK, ...entry }].slice(-50);

  if (action === 'done') {
    const stage = review.stage + 1;
    return {
      ...review,
      stage,
      dueOn: addDays(todayK, intervalAt(intervals, stage)),
      lastReviewedAt: todayK,
      needsReview: false,
      history: log({ action }),
    };
  }

  if (action === 'ace') {
    // The rung being skipped is also the wait: it is the longest gap this
    // problem has already earned, and jumping straight to the new rung's
    // interval would double an untested one.
    const days = intervalAt(intervals, review.stage + 1);
    return {
      ...review,
      stage: review.stage + 2,
      dueOn: addDays(todayK, days),
      lastReviewedAt: todayK,
      needsReview: false,
      history: log({ action, days }),
    };
  }

  if (action === 'again') {
    return {
      ...review,
      stage: 0,
      dueOn: addDays(todayK, intervalAt(intervals, 0)),
      lastReviewedAt: todayK,
      needsReview: false,
      history: log({ action }),
    };
  }

  if (action === 'delay' || action === 'snooze') {
    const days = normaliseDelay(opts.days ?? 1) ?? 1;
    return {
      ...review,
      dueOn: addDays(pushFrom(review, todayK), days),
      history: log({ action: 'delay', days }),
    };
  }

  if (action === 'skip') {
    const days = intervalAt(intervals, review.stage);
    return {
      ...review,
      dueOn: addDays(pushFrom(review, todayK), days),
      history: log({ action, days }),
    };
  }

  if (action === 'flag' || action === 'unflag') {
    return { ...review, needsReview: action === 'flag', history: log({ action }) };
  }

  if (action === 'retire') {
    // The flag goes with it — a retired problem must not jump a queue it is no
    // longer part of, and un-retiring it later shouldn't spring a surprise.
    return { ...review, retired: true, needsReview: false, history: log({ action }) };
  }

  if (action === 'restore') {
    return {
      ...review,
      retired: false,
      // Back on the schedule, not back in a hole: a due date that went stale
      // while it was off the calendar becomes today rather than months overdue.
      dueOn: pushFrom(review, todayK),
      history: log({ action }),
    };
  }

  return review;
}

/** Reviews still on the schedule. A retired one stays stored, just not counted. */
export function activeReviews(reviews) {
  return Object.values(reviews).filter((r) => !r.retired);
}

export function retiredReviews(reviews) {
  return Object.values(reviews)
    .filter((r) => r.retired)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * The queue: everything due on or before `key`, plus anything flagged as
 * needing review whatever its due date. Flagged first, then oldest due first.
 */
export function dueBy(reviews, key) {
  return activeReviews(reviews)
    .filter((r) => r.dueOn <= key || r.needsReview)
    .sort((a, b) =>
      Number(!!b.needsReview) - Number(!!a.needsReview)
      || a.dueOn.localeCompare(b.dueOn)
      || a.slug.localeCompare(b.slug));
}

export function flaggedReviews(reviews) {
  return activeReviews(reviews)
    .filter((r) => r.needsReview)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.slug.localeCompare(b.slug));
}

/** { "YYYY-MM-DD": count } of items scheduled exactly on each day. */
export function dueCountsByDay(reviews) {
  const out = {};
  for (const r of activeReviews(reviews)) {
    out[r.dueOn] = (out[r.dueOn] || 0) + 1;
  }
  return out;
}

export function parseIntervals(text) {
  const list = String(text)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= MAX_DELAY)
    .map((n) => Math.round(n));
  return list.length ? [...new Set(list)].sort((a, b) => a - b) : DEFAULT_INTERVALS;
}

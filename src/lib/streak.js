// Streak math over the derived per-day rollup.
//
// `days` is { "YYYY-MM-DD": { attempts, accepted, solved } }. A day counts as
// active when at least one problem was solved on it.

import { addDays, diffDays } from './time.js';

export function activeDayKeys(days) {
  return Object.keys(days)
    .filter((k) => days[k] && days[k].solved > 0)
    .sort();
}

/**
 * Current streak deliberately does not break on an empty *today*: the day is
 * still in progress, so we fall back to yesterday as the anchor. It only dies
 * once a full day has passed with nothing solved.
 */
export function computeStreak(days, todayK) {
  const active = new Set(activeDayKeys(days));

  let current = 0;
  let cursor = active.has(todayK) ? todayK : addDays(todayK, -1);
  while (active.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let prev = null;
  for (const k of [...active].sort()) {
    run = prev && diffDays(prev, k) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = k;
  }

  return {
    current,
    longest: Math.max(longest, current),
    activeDays: active.size,
    solvedToday: active.has(todayK),
    // How many more consecutive days until `current` beats `longest`.
    toRecord: Math.max(0, longest - current + 1),
  };
}

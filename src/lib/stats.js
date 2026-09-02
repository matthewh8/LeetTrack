// Derived statistics for the dashboard. Pure: no chrome.*, no Date.now().

import { windowKeys } from './time.js';

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

export function difficultyCounts(problems) {
  const counts = { Easy: 0, Medium: 0, Hard: 0, Unknown: 0 };
  for (const p of Object.values(problems)) {
    const d = DIFFICULTIES.includes(p.difficulty) ? p.difficulty : 'Unknown';
    counts[d] += 1;
  }
  counts.total = Object.keys(problems).length;
  return counts;
}

/**
 * Submission quality over the last `n` days ending at `endKey`.
 * Reads the day rollup, so cost is O(window) rather than O(all attempts).
 */
export function qualityStats(days, endKey, n = 14) {
  const series = windowKeys(endKey, n).map((key) => {
    const d = days[key] || {};
    return {
      key,
      attempts: d.attempts || 0,
      accepted: d.accepted || 0,
      solved: d.solved || 0,
      wrong: Math.max(0, (d.attempts || 0) - (d.accepted || 0)),
    };
  });

  const attempts = series.reduce((s, d) => s + d.attempts, 0);
  const accepted = series.reduce((s, d) => s + d.accepted, 0);

  let bestDay = null;
  for (const d of series) {
    if (!d.accepted) continue;
    // Most accepted wins; ties go to the day that needed fewer attempts.
    if (!bestDay || d.accepted > bestDay.accepted || (d.accepted === bestDay.accepted && d.attempts < bestDay.attempts)) {
      bestDay = d;
    }
  }

  return {
    series,
    attempts,
    accepted,
    wrong: attempts - accepted,
    acceptanceRate: attempts ? accepted / attempts : 0,
    attemptsPerAc: accepted ? attempts / accepted : 0,
    bestDay,
  };
}

/** The problem that took the most wrong answers inside the window. */
export function mostRetried(attempts, windowStartKey, dayKeyOf) {
  const wrongBySlug = new Map();
  for (const a of attempts) {
    if (dayKeyOf(a) < windowStartKey) continue;
    if (a.verdict === 'Accepted') continue;
    wrongBySlug.set(a.slug, (wrongBySlug.get(a.slug) || 0) + 1);
  }
  let top = null;
  for (const [slug, wrong] of wrongBySlug) {
    if (!top || wrong > top.wrong) top = { slug, wrong };
  }
  return top;
}

export function recentSolves(problems, limit = 8) {
  return Object.values(problems)
    .filter((p) => p.lastSolvedAt)
    .sort((a, b) => b.lastSolvedAt - a.lastSolvedAt)
    .slice(0, limit);
}

/** Buckets a day's solve count into a 0..4 heatmap intensity level. */
export function heatLevel(solved) {
  if (!solved) return 0;
  if (solved === 1) return 1;
  if (solved <= 3) return 2;
  if (solved <= 5) return 3;
  return 4;
}

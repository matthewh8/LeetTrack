// Trimming history back to a start date.
//
// Two things have to happen for "start counting from <date>" to stick. The old
// rows have to go (this module), and the backfill has to stop re-importing them
// (the `trackFrom` cutoff in storage.js). Without the second half, the next
// `recentAcSubmissionList` sync walks the last 20 accepted solves straight back
// into storage.
//
// Pure: takes a state object, returns a new one. No chrome.*, no Date.now().

import { dayKey } from './time.js';

/**
 * Drop everything that happened before `fromKey`.
 *
 * A problem survives if it was solved on or after the cutoff. Surviving
 * problems are re-derived from the attempts that survive with them, so
 * `solveCount` and `firstSolvedAt` describe the kept history rather than the
 * deleted one. Reviews follow their problem.
 *
 * @param {{problems:Object, attempts:Array, days:Object, reviews:Object}} state
 * @param {string} fromKey  inclusive "YYYY-MM-DD" start of the kept range
 * @param {string} timeZone IANA zone the day keys were recorded in
 */
export function pruneState(state, fromKey, timeZone) {
  const before = {
    attempts: (state.attempts || []).length,
    days: Object.keys(state.days || {}).length,
    problems: Object.keys(state.problems || {}).length,
    reviews: Object.keys(state.reviews || {}).length,
  };

  const attempts = (state.attempts || []).filter((a) => keyOfAttempt(a, timeZone) >= fromKey);
  const days = Object.fromEntries(
    Object.entries(state.days || {}).filter(([key]) => key >= fromKey),
  );

  // Evidence from the attempts that survived, so kept counts match kept rows.
  const kept = new Map();
  for (const a of attempts) {
    if (a.verdict !== 'Accepted') continue;
    const seen = kept.get(a.slug);
    if (seen) {
      seen.first = Math.min(seen.first, a.at);
      seen.last = Math.max(seen.last, a.at);
      seen.count += 1;
    } else {
      kept.set(a.slug, { first: a.at, last: a.at, count: 1 });
    }
  }

  const problems = {};
  for (const [slug, p] of Object.entries(state.problems || {})) {
    const evidence = kept.get(slug);
    // No surviving attempt row is not the same as no surviving solve: attempts
    // are capped at 5000 and sync-only solves predate their own rollup. Fall
    // back to the problem's own last-solved stamp.
    const solvedInRange = evidence || (p.lastSolvedAt && dayKey(new Date(p.lastSolvedAt), timeZone) >= fromKey);
    if (!solvedInRange) continue;

    const lastSolvedAt = Math.max(p.lastSolvedAt || 0, evidence?.last || 0);
    problems[slug] = {
      ...p,
      firstSolvedAt: evidence ? evidence.first : lastSolvedAt,
      lastSolvedAt,
      solveCount: evidence ? evidence.count : 1,
    };
  }

  const reviews = Object.fromEntries(
    Object.entries(state.reviews || {}).filter(([slug]) => problems[slug]),
  );

  return {
    state: { problems, attempts, days, reviews },
    removed: {
      attempts: before.attempts - attempts.length,
      days: before.days - Object.keys(days).length,
      problems: before.problems - Object.keys(problems).length,
      reviews: before.reviews - Object.keys(reviews).length,
    },
  };
}

// `day` is written at record time in the timezone that was active then; only
// fall back to recomputing it when an older row is missing one.
function keyOfAttempt(attempt, timeZone) {
  return attempt.day || dayKey(new Date(attempt.at), timeZone);
}

/** True when anything in `state` predates `fromKey` — i.e. a prune would bite. */
export function hasHistoryBefore(state, fromKey, timeZone) {
  const { removed } = pruneState(state, fromKey, timeZone);
  return Object.values(removed).some((n) => n > 0);
}

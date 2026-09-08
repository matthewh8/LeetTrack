// Finding one problem among all of them.
//
// The dashboard's other views each answer a scheduling question — what is due,
// what did I just solve, what have I practised. None of them answers "where is
// that binary search problem I did in March", which is the question you have
// when you want to go back to something specific. This is the index that does:
// every tracked problem, searchable by text and narrowed by the same group and
// difficulty filter the Reviews card uses.
//
// Pure: no chrome.*, no Date.now(). The caller passes today's key.

import { visibleTags, patternsOf } from './patterns.js';

export const STATUS_FILTERS = [
  { value: 'all', label: 'Any status' },
  { value: 'due', label: 'Due now' },
  { value: 'upcoming', label: 'Scheduled' },
  { value: 'needs-review', label: 'Needs review' },
  { value: 'removed', label: 'Removed from review' },
  { value: 'unscheduled', label: 'Not scheduled' },
];

export const SORTS = [
  { value: 'recent', label: 'Recently solved' },
  { value: 'due', label: 'Next review' },
  { value: 'number', label: 'Problem number' },
  { value: 'title', label: 'Title' },
  { value: 'difficulty', label: 'Difficulty' },
  { value: 'solves', label: 'Times solved' },
];

const DIFF_ORDER = { Easy: 0, Medium: 1, Hard: 2, Unknown: 3 };

/** Search terms, lowercased. Multiple terms all have to match. */
export function tokenize(query) {
  return String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

/** The one label a problem wears in the list. Flagged outranks merely due. */
export function statusOf(review, todayK) {
  if (!review) return 'unscheduled';
  if (review.retired) return 'removed';
  if (review.needsReview) return 'needs-review';
  return review.dueOn <= todayK ? 'due' : 'upcoming';
}

/**
 * One row per tracked problem, with everything the list and the filters need
 * already derived — so filtering and sorting never touch the raw records.
 */
export function problemRows(problems, reviews, todayK) {
  return Object.values(problems || {}).map((p) => {
    const review = (reviews || {})[p.slug] || null;
    const tags = visibleTags(p);
    const retired = !!review?.retired;
    const difficulty = p.difficulty || 'Unknown';
    return {
      slug: p.slug,
      title: p.title || p.slug,
      frontendId: p.frontendId || null,
      difficulty,
      tags,
      patterns: patternsOf(p),
      solveCount: p.solveCount || 0,
      lastSolvedAt: p.lastSolvedAt || 0,
      review,
      // Only a scheduled problem has a due date worth showing or sorting on.
      dueOn: review && !retired ? review.dueOn : null,
      retired,
      flagged: !!review?.needsReview && !retired,
      due: !!review && !retired && review.dueOn <= todayK,
      upcoming: !!review && !retired && review.dueOn > todayK,
      unscheduled: !review,
      status: statusOf(review, todayK),
      // Number, title, slug, difficulty and every tag in one string: a term
      // matches if it appears anywhere, so "hard graph" and "1. two" both work.
      haystack: [p.frontendId, p.title, p.slug, difficulty, ...tags]
        .filter(Boolean).join(' ').toLowerCase(),
    };
  });
}

export function matchesStatus(row, status) {
  switch (status) {
    case 'due': return row.due;
    case 'upcoming': return row.upcoming;
    case 'needs-review': return row.flagged;
    case 'removed': return row.retired;
    case 'unscheduled': return row.unscheduled;
    default: return true;
  }
}

/**
 * Group matching is on the problem's whole tag list rather than the one or two
 * chips it shows — the same rule the Reviews filter uses, so setting a group in
 * one place means the same thing in the other.
 */
export function matchesRow(row, { tokens = [], group = 'all', difficulty = 'all', status = 'all' } = {}) {
  return tokens.every((t) => row.haystack.includes(t))
    && (group === 'all' || row.tags.includes(group))
    && (difficulty === 'all' || row.difficulty === difficulty)
    && matchesStatus(row, status);
}

export function sortRows(rows, sort = 'recent') {
  const byTitle = (a, b) => a.title.localeCompare(b.title);
  const list = [...rows];

  switch (sort) {
    case 'title':
      return list.sort(byTitle);
    case 'number':
      // Unnumbered problems (captured live, not yet enriched) sort last rather
      // than colliding at zero.
      return list.sort((a, b) =>
        (Number(a.frontendId) || Infinity) - (Number(b.frontendId) || Infinity) || byTitle(a, b));
    case 'difficulty':
      return list.sort((a, b) => DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty] || byTitle(a, b));
    case 'solves':
      return list.sort((a, b) => b.solveCount - a.solveCount || byTitle(a, b));
    case 'due':
      // Unscheduled and removed problems have no date; they go after the ones
      // that do rather than sorting as if due in 1970.
      return list.sort((a, b) => {
        if (a.dueOn && b.dueOn) return a.dueOn.localeCompare(b.dueOn) || byTitle(a, b);
        if (a.dueOn) return -1;
        if (b.dueOn) return 1;
        return byTitle(a, b);
      });
    default:
      return list.sort((a, b) => b.lastSolvedAt - a.lastSolvedAt || byTitle(a, b));
  }
}

/** Filter and sort in one call — what the dashboard actually uses. */
export function searchProblems(rows, opts = {}) {
  const tokens = tokenize(opts.query);
  return sortRows(rows.filter((r) => matchesRow(r, { ...opts, tokens })), opts.sort);
}

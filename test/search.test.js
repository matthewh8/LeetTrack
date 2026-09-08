import test from 'node:test';
import assert from 'node:assert/strict';
import {
  problemRows, searchProblems, sortRows, statusOf, tokenize, matchesStatus, matchesRow,
} from '../src/lib/search.js';

const TODAY = '2026-09-08';
const at = (key) => Date.parse(`${key}T18:00:00Z`);

const problems = {
  'two-sum': {
    slug: 'two-sum', title: 'Two Sum', frontendId: '1', difficulty: 'Easy',
    topicTags: ['Array', 'Hash Table'], solveCount: 3, lastSolvedAt: at('2026-09-06'),
  },
  'lru-cache': {
    slug: 'lru-cache', title: 'LRU Cache', frontendId: '146', difficulty: 'Medium',
    topicTags: ['Hash Table', 'Linked List', 'Design', 'Doubly-Linked List'],
    solveCount: 1, lastSolvedAt: at('2026-09-07'),
  },
  'word-ladder': {
    slug: 'word-ladder', title: 'Word Ladder', frontendId: '127', difficulty: 'Hard',
    topicTags: ['Hash Table', 'String', 'Breadth-First Search'],
    solveCount: 1, lastSolvedAt: at('2026-09-01'),
  },
  'n-queens': {
    slug: 'n-queens', title: 'N-Queens', frontendId: '51', difficulty: 'Hard',
    topicTags: ['Array', 'Backtracking'], solveCount: 1, lastSolvedAt: at('2026-08-20'),
  },
};

const reviews = {
  'two-sum': { slug: 'two-sum', stage: 1, dueOn: '2026-09-08' },           // due today
  'lru-cache': { slug: 'lru-cache', stage: 2, dueOn: '2026-09-20' },       // upcoming
  'word-ladder': { slug: 'word-ladder', stage: 0, dueOn: '2026-08-01', retired: true },
  // n-queens has no review row at all
};

const rows = () => problemRows(problems, reviews, TODAY);
const slugs = (list) => list.map((r) => r.slug);
const find = (opts) => slugs(searchProblems(rows(), opts));

test('tokenize splits on whitespace and lowercases', () => {
  assert.deepEqual(tokenize('  Hard   Graph '), ['hard', 'graph']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
});

test('search matches title, number, slug and tags', () => {
  assert.deepEqual(find({ query: 'two sum' }), ['two-sum']);
  assert.deepEqual(find({ query: 'LRU' }), ['lru-cache']);
  assert.deepEqual(find({ query: '146' }), ['lru-cache']);          // problem number
  assert.deepEqual(find({ query: 'word-ladder' }), ['word-ladder']); // slug
  assert.deepEqual(find({ query: 'backtracking' }), ['n-queens']);   // a tag it doesn't show
});

test('every term has to match, so terms narrow', () => {
  // "hash" alone is three problems; adding "hard" leaves the one.
  assert.equal(find({ query: 'hash' }).length, 3);
  assert.deepEqual(find({ query: 'hash hard' }), ['word-ladder']);
  assert.deepEqual(find({ query: 'hash unicorn' }), []);
});

test('search is case insensitive', () => {
  assert.deepEqual(find({ query: 'n-QUEENS' }), ['n-queens']);
});

test('a tag the chips never show is still searchable and filterable', () => {
  // LRU Cache's chips surface Design/Linked List, not "Doubly-Linked List".
  assert.deepEqual(find({ query: 'doubly' }), ['lru-cache']);
  assert.deepEqual(find({ group: 'Doubly-Linked List' }), ['lru-cache']);
});

test('group and difficulty filters combine with the search', () => {
  assert.deepEqual(find({ group: 'Array' }).sort(), ['n-queens', 'two-sum']);
  assert.deepEqual(find({ difficulty: 'Hard' }).sort(), ['n-queens', 'word-ladder']);
  assert.deepEqual(find({ group: 'Array', difficulty: 'Hard' }), ['n-queens']);
  assert.deepEqual(find({ group: 'Array', query: 'sum' }), ['two-sum']);
});

test('status buckets split scheduled, removed and never-scheduled', () => {
  assert.equal(statusOf(reviews['two-sum'], TODAY), 'due');
  assert.equal(statusOf(reviews['lru-cache'], TODAY), 'upcoming');
  assert.equal(statusOf(reviews['word-ladder'], TODAY), 'removed');
  assert.equal(statusOf(null, TODAY), 'unscheduled');
  assert.equal(statusOf({ dueOn: '2026-12-01', needsReview: true }, TODAY), 'needs-review');

  assert.deepEqual(find({ status: 'due' }), ['two-sum']);
  assert.deepEqual(find({ status: 'upcoming' }), ['lru-cache']);
  assert.deepEqual(find({ status: 'removed' }), ['word-ladder']);
  assert.deepEqual(find({ status: 'unscheduled' }), ['n-queens']);
  assert.equal(find({ status: 'all' }).length, 4);
});

test('a removed problem is never due, whatever its stale date says', () => {
  // word-ladder's dueOn is over a month past, but it is off the schedule.
  const row = rows().find((r) => r.slug === 'word-ladder');
  assert.equal(row.due, false);
  assert.equal(row.dueOn, null);
  assert.equal(matchesStatus(row, 'due'), false);
});

test('a flagged problem reads as needs-review, not as its due date', () => {
  const flagged = problemRows(problems, {
    'two-sum': { slug: 'two-sum', stage: 1, dueOn: '2026-12-01', needsReview: true },
  }, TODAY).find((r) => r.slug === 'two-sum');
  assert.equal(flagged.status, 'needs-review');
  assert.equal(flagged.flagged, true);
  assert.equal(flagged.upcoming, true); // still scheduled, just marked
});

test('sorts do what they say', () => {
  assert.deepEqual(slugs(sortRows(rows(), 'recent')),
    ['lru-cache', 'two-sum', 'word-ladder', 'n-queens']);
  assert.deepEqual(slugs(sortRows(rows(), 'number')),
    ['two-sum', 'n-queens', 'word-ladder', 'lru-cache']); // 1, 51, 127, 146
  assert.deepEqual(slugs(sortRows(rows(), 'title')),
    ['lru-cache', 'n-queens', 'two-sum', 'word-ladder']);
  assert.deepEqual(slugs(sortRows(rows(), 'difficulty')),
    ['two-sum', 'lru-cache', 'n-queens', 'word-ladder']); // Easy, Medium, Hard×2 by title
  assert.deepEqual(slugs(sortRows(rows(), 'solves'))[0], 'two-sum');
});

test('sorting by next review puts the undated last, not first', () => {
  // A removed or unscheduled problem has no date; sorting must not treat that
  // as "due in 1970" and float them above everything real.
  assert.deepEqual(slugs(sortRows(rows(), 'due')),
    ['two-sum', 'lru-cache', 'n-queens', 'word-ladder']);
});

test('an unnumbered problem sorts last by number rather than first', () => {
  const withUnnumbered = {
    ...problems,
    fresh: { slug: 'fresh', title: 'Fresh Capture', difficulty: 'Easy', topicTags: [], lastSolvedAt: at('2026-09-08') },
  };
  const list = sortRows(problemRows(withUnnumbered, reviews, TODAY), 'number');
  assert.equal(list.at(-1).slug, 'fresh');
});

test('rows carry what the list needs without re-reading the records', () => {
  const row = rows().find((r) => r.slug === 'two-sum');
  assert.equal(row.title, 'Two Sum');
  assert.equal(row.frontendId, '1');
  assert.equal(row.solveCount, 3);
  assert.equal(row.due, true);
  assert.deepEqual(row.tags, ['Array', 'Hash Table']);
  assert.ok(row.patterns.length);
});

test('removed tags drop out of search and filtering', () => {
  // hiddenTags is the per-problem overlay the tag editor writes.
  const edited = { ...problems, 'two-sum': { ...problems['two-sum'], hiddenTags: ['Hash Table'] } };
  const list = searchProblems(problemRows(edited, reviews, TODAY), { query: 'hash' });
  assert.deepEqual(slugs(list).sort(), ['lru-cache', 'word-ladder']);
  assert.deepEqual(slugs(searchProblems(problemRows(edited, reviews, TODAY), { group: 'Hash Table' })).sort(),
    ['lru-cache', 'word-ladder']);
});

test('an empty search returns everything, untouched', () => {
  assert.equal(find({}).length, 4);
  assert.equal(find({ query: '   ' }).length, 4);
});

test('matchesRow is the whole predicate in one place', () => {
  const row = rows().find((r) => r.slug === 'lru-cache');
  assert.equal(matchesRow(row, { tokens: ['lru'], group: 'Design', difficulty: 'Medium' }), true);
  assert.equal(matchesRow(row, { tokens: ['lru'], difficulty: 'Hard' }), false);
  assert.equal(matchesRow(row, { tokens: ['nope'] }), false);
});

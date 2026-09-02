import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneState, hasHistoryBefore } from '../src/lib/prune.js';

const TZ = 'America/Los_Angeles';
const at = (key, hour = 12) => Date.parse(`${key}T${String(hour).padStart(2, '0')}:00:00-07:00`);

function fixture() {
  return {
    problems: {
      old: { slug: 'old', title: 'Old', firstSolvedAt: at('2026-08-20'), lastSolvedAt: at('2026-08-20'), solveCount: 1 },
      both: { slug: 'both', title: 'Both', firstSolvedAt: at('2026-08-25'), lastSolvedAt: at('2026-09-02'), solveCount: 3 },
      fresh: { slug: 'fresh', title: 'Fresh', firstSolvedAt: at('2026-09-02'), lastSolvedAt: at('2026-09-02'), solveCount: 1 },
    },
    attempts: [
      { id: '1', slug: 'old', at: at('2026-08-20'), day: '2026-08-20', verdict: 'Accepted' },
      { id: '2', slug: 'both', at: at('2026-08-25'), day: '2026-08-25', verdict: 'Accepted' },
      { id: '3', slug: 'both', at: at('2026-09-02', 9), day: '2026-09-02', verdict: 'Wrong Answer' },
      { id: '4', slug: 'both', at: at('2026-09-02', 10), day: '2026-09-02', verdict: 'Accepted' },
      { id: '5', slug: 'fresh', at: at('2026-09-02'), day: '2026-09-02', verdict: 'Accepted' },
    ],
    days: {
      '2026-08-20': { attempts: 1, accepted: 1, solved: 1, slugs: ['old'] },
      '2026-08-25': { attempts: 1, accepted: 1, solved: 1, slugs: ['both'] },
      '2026-09-02': { attempts: 3, accepted: 2, solved: 2, slugs: ['both', 'fresh'] },
    },
    reviews: {
      old: { slug: 'old', stage: 1, dueOn: '2026-08-23' },
      both: { slug: 'both', stage: 0, dueOn: '2026-09-03' },
      fresh: { slug: 'fresh', stage: 0, dueOn: '2026-09-03' },
    },
  };
}

test('keeps only days on or after the cutoff', () => {
  const { state } = pruneState(fixture(), '2026-09-02', TZ);
  assert.deepEqual(Object.keys(state.days), ['2026-09-02']);
  assert.deepEqual(state.attempts.map((a) => a.id), ['3', '4', '5']);
});

test('drops problems whose last solve predates the cutoff, with their reviews', () => {
  const { state } = pruneState(fixture(), '2026-09-02', TZ);
  assert.deepEqual(Object.keys(state.problems).sort(), ['both', 'fresh']);
  assert.deepEqual(Object.keys(state.reviews).sort(), ['both', 'fresh']);
});

test('re-derives kept problems from the attempts that survived', () => {
  const { state } = pruneState(fixture(), '2026-09-02', TZ);
  const both = state.problems.both;
  assert.equal(both.solveCount, 1); // the 08-25 solve is gone
  assert.equal(both.firstSolvedAt, at('2026-09-02', 10));
  assert.equal(both.lastSolvedAt, at('2026-09-02'));
  assert.equal(both.title, 'Both'); // metadata is preserved
});

test('a solve with no surviving attempt row still keeps its problem', () => {
  const s = fixture();
  s.attempts = []; // e.g. trimmed by the attempt cap, or imported by sync only
  const { state } = pruneState(s, '2026-09-02', TZ);
  assert.deepEqual(Object.keys(state.problems).sort(), ['both', 'fresh']);
  assert.equal(state.problems.both.solveCount, 1);
  assert.equal(state.problems.both.firstSolvedAt, state.problems.both.lastSolvedAt);
});

test('reports what it removed', () => {
  const { removed } = pruneState(fixture(), '2026-09-02', TZ);
  assert.deepEqual(removed, { attempts: 2, days: 2, problems: 1, reviews: 1 });
});

test('a cutoff before all history is a no-op', () => {
  const before = fixture();
  const { state, removed } = pruneState(before, '2026-01-01', TZ);
  assert.deepEqual(removed, { attempts: 0, days: 0, problems: 0, reviews: 0 });
  assert.deepEqual(state.days, before.days);
  assert.equal(hasHistoryBefore(before, '2026-01-01', TZ), false);
  assert.equal(hasHistoryBefore(before, '2026-09-02', TZ), true);
});

test('a cutoff after all history leaves nothing behind', () => {
  const { state } = pruneState(fixture(), '2026-12-01', TZ);
  assert.deepEqual(state, { problems: {}, attempts: [], days: {}, reviews: {} });
});

test('day keys, not raw timestamps, decide the boundary', () => {
  // 2026-09-02 23:30 in Los Angeles is 2026-09-03 in UTC; the recorded day wins.
  const s = {
    problems: {}, days: {}, reviews: {},
    attempts: [{ id: 'late', slug: 'x', at: at('2026-09-02', 23), day: '2026-09-02', verdict: 'Accepted' }],
  };
  assert.equal(pruneState(s, '2026-09-03', TZ).state.attempts.length, 0);
  assert.equal(pruneState(s, '2026-09-02', TZ).state.attempts.length, 1);
});

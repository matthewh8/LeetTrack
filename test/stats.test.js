import test from 'node:test';
import assert from 'node:assert/strict';
import { difficultyCounts, qualityStats, mostRetried, recentSolves, heatLevel } from '../src/lib/stats.js';

test('difficultyCounts buckets and totals', () => {
  const c = difficultyCounts({
    a: { difficulty: 'Easy' }, b: { difficulty: 'Medium' },
    c: { difficulty: 'Medium' }, d: { difficulty: undefined },
  });
  assert.equal(c.Easy, 1);
  assert.equal(c.Medium, 2);
  assert.equal(c.Hard, 0);
  assert.equal(c.Unknown, 1);
  assert.equal(c.total, 4);
});

test('qualityStats matches the screenshot numbers', () => {
  // 3 attempts, 3 accepted, 0 wrong -> 100% / 1.0 per AC
  const days = { '2026-09-02': { attempts: 2, accepted: 2, solved: 1 }, '2026-09-03': { attempts: 1, accepted: 1, solved: 0 } };
  const q = qualityStats(days, '2026-09-03', 14);
  assert.equal(q.attempts, 3);
  assert.equal(q.accepted, 3);
  assert.equal(q.wrong, 0);
  assert.equal(q.acceptanceRate, 1);
  assert.equal(q.attemptsPerAc, 1);
  assert.equal(q.series.length, 14);
});

test('qualityStats does not divide by zero on an empty window', () => {
  const q = qualityStats({}, '2026-09-03', 14);
  assert.equal(q.acceptanceRate, 0);
  assert.equal(q.attemptsPerAc, 0);
  assert.equal(q.bestDay, null);
});

test('bestDay breaks ties on fewer attempts', () => {
  const days = {
    '2026-09-01': { attempts: 6, accepted: 2, solved: 2 },
    '2026-09-02': { attempts: 2, accepted: 2, solved: 2 },
  };
  assert.equal(qualityStats(days, '2026-09-03', 14).bestDay.key, '2026-09-02');
});

test('mostRetried ignores accepted attempts and older ones', () => {
  const attempts = [
    { slug: 'old', verdict: 'Wrong Answer', day: '2026-08-01' },
    { slug: 'a', verdict: 'Wrong Answer', day: '2026-09-01' },
    { slug: 'a', verdict: 'Wrong Answer', day: '2026-09-02' },
    { slug: 'a', verdict: 'Accepted', day: '2026-09-02' },
    { slug: 'b', verdict: 'Wrong Answer', day: '2026-09-02' },
  ];
  const top = mostRetried(attempts, '2026-08-25', (a) => a.day);
  assert.deepEqual(top, { slug: 'a', wrong: 2 });
});

test('mostRetried returns null with a clean window', () => {
  assert.equal(mostRetried([{ slug: 'a', verdict: 'Accepted', day: '2026-09-02' }], '2026-08-25', (a) => a.day), null);
});

test('recentSolves is newest first and skips unsolved', () => {
  const out = recentSolves({
    a: { slug: 'a', lastSolvedAt: 100 },
    b: { slug: 'b', lastSolvedAt: 300 },
    c: { slug: 'c', lastSolvedAt: null },
  });
  assert.deepEqual(out.map((p) => p.slug), ['b', 'a']);
});

test('heatLevel ramps 0..4', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 6, 20].map(heatLevel), [0, 1, 2, 2, 3, 4, 4]);
});

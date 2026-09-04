import test from 'node:test';
import assert from 'node:assert/strict';
import { difficultyCounts, recentSolves, heatLevel } from '../src/lib/stats.js';

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

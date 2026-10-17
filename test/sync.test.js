import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeSnapshots, toSnapshot, encodeSnapshot, decodeSnapshot, checksum, canonical, fitSnapshot,
  MAX_CHUNKS, CHUNK_CHARS,
} from '../src/lib/sync.js';

const W = '2|America/New_York';
const settings = (extra = {}) => ({ timezone: 'America/New_York', dayStartHour: 2, intervals: [1, 3, 7], ...extra });
const snap = (parts = {}) => ({ v: 1, dayWindow: W, settings: settings(), problems: {}, reviews: {}, days: {}, attempts: [], ...parts });

test('records only one side has are kept from both', () => {
  const a = snap({ problems: { 'two-sum': { slug: 'two-sum', lastSolvedAt: 1, solveCount: 1 } } });
  const b = snap({ problems: { '3sum': { slug: '3sum', lastSolvedAt: 2, solveCount: 1 } } });
  const m = mergeSnapshots(a, b);
  assert.deepEqual(Object.keys(m.problems).sort(), ['3sum', 'two-sum']);
});

test('the later edit to a review wins', () => {
  const a = snap({ reviews: { x: { slug: 'x', stage: 1, modAt: 100 } } });
  const b = snap({ reviews: { x: { slug: 'x', stage: 3, modAt: 200 } } });
  assert.equal(mergeSnapshots(a, b).reviews.x.stage, 3);
  assert.equal(mergeSnapshots(b, a).reviews.x.stage, 3);
});

test('unstamped reviews fall back to the longer history', () => {
  const a = snap({ reviews: { x: { slug: 'x', stage: 1, history: [{}] } } });
  const b = snap({ reviews: { x: { slug: 'x', stage: 2, history: [{}, {}] } } });
  assert.equal(mergeSnapshots(a, b).reviews.x.stage, 2);
});

test('problem counts combine instead of one side overwriting', () => {
  const a = snap({ problems: { x: { slug: 'x', firstSolvedAt: 50, lastSolvedAt: 100, solveCount: 2, modAt: 300 } } });
  const b = snap({ problems: { x: { slug: 'x', firstSolvedAt: 10, lastSolvedAt: 200, solveCount: 3, modAt: 100 } } });
  const p = mergeSnapshots(a, b).problems.x;
  assert.deepEqual([p.firstSolvedAt, p.lastSolvedAt, p.solveCount], [10, 200, 3]);
});

test('days union their solved slugs', () => {
  const a = snap({ days: { '2026-10-01': { attempts: 2, accepted: 1, solved: 1, slugs: ['a'] } } });
  const b = snap({ days: { '2026-10-01': { attempts: 1, accepted: 1, solved: 1, slugs: ['b'] } } });
  const d = mergeSnapshots(a, b).days['2026-10-01'];
  assert.deepEqual(d.slugs.sort(), ['a', 'b']);
  assert.equal(d.solved, 2);
  assert.ok(d.accepted >= 2);
});

test('days filed under another day window are not unioned', () => {
  const a = snap({ days: { '2026-10-01': { attempts: 1, accepted: 1, solved: 1, slugs: ['a'] } } });
  const b = snap({ dayWindow: '0|America/New_York', days: { '2026-10-02': { attempts: 1, accepted: 1, solved: 1, slugs: ['b'] } } });
  assert.deepEqual(Object.keys(mergeSnapshots(a, b).days), ['2026-10-01']);
});

test('attempts are de-duplicated by id', () => {
  const at = (id, t) => ({ id, slug: 's', at: t, day: '2026-10-01', verdict: 'Accepted' });
  const m = mergeSnapshots(snap({ attempts: [at('1', 1), at('2', 2)] }), snap({ attempts: [at('2', 2), at('3', 3)] }));
  assert.deepEqual(m.attempts.map((a) => a.id), ['1', '2', '3']);
});

test('fresh-install defaults lose to settings that were ever saved', () => {
  const fresh = snap({ settings: settings({ intervals: [1, 3, 7] }) });
  const used = snap({
    settings: settings({ intervals: [2, 4] }),
    problems: { x: { slug: 'x' } },
  });
  assert.deepEqual(mergeSnapshots(fresh, used).settings.intervals, [2, 4]);
  const saved = snap({ settings: settings({ intervals: [5], modAt: 10 }) });
  assert.deepEqual(mergeSnapshots(used, saved).settings.intervals, [5]);
});

test('a history reset on one device trims the other device\'s older rows', () => {
  const old = Date.parse('2026-09-01T15:00:00Z');
  const recent = Date.parse('2026-10-10T15:00:00Z');
  const reset = snap({
    settings: settings({ trackFrom: '2026-10-01', modAt: 500 }),
    problems: { fresh: { slug: 'fresh', lastSolvedAt: recent, solveCount: 1 } },
  });
  const other = snap({
    problems: { stale: { slug: 'stale', lastSolvedAt: old, solveCount: 1 } },
    reviews: { stale: { slug: 'stale', stage: 0 } },
    days: { '2026-09-01': { attempts: 1, accepted: 1, solved: 1, slugs: ['stale'] } },
  });
  const m = mergeSnapshots(other, reset);
  assert.deepEqual(Object.keys(m.problems), ['fresh']);
  assert.deepEqual(m.reviews, {});
  assert.deepEqual(m.days, {});
});

test('merging a snapshot with itself changes nothing', () => {
  const a = snap({
    problems: { x: { slug: 'x', firstSolvedAt: 1, lastSolvedAt: 2, solveCount: 1, modAt: 5 } },
    reviews: { x: { slug: 'x', stage: 1, modAt: 5, history: [] } },
    days: { '2026-10-01': { attempts: 1, accepted: 1, solved: 1, slugs: ['x'], modAt: 5 } },
  });
  assert.equal(canonical(mergeSnapshots(a, a)), canonical(a));
});

test('a snapshot from an unknown version is ignored', () => {
  const a = snap({ problems: { x: { slug: 'x' } } });
  assert.equal(mergeSnapshots(a, { v: 99 }), a);
  assert.equal(mergeSnapshots(a, null), a);
});

test('encode and decode round-trip through chunks', async () => {
  const s = snap({ problems: { x: { slug: 'x', title: 'X'.repeat(20000) } } });
  const chunks = await encodeSnapshot(s);
  assert.ok(chunks.every((c) => c.length <= CHUNK_CHARS));
  const head = { n: chunks.length, sum: checksum(chunks.join('')) };
  assert.deepEqual(await decodeSnapshot(head, chunks), s);
});

test('a half-arrived set of chunks decodes to null', async () => {
  const chunks = await encodeSnapshot(snap({ problems: { x: { slug: 'x' } } }));
  const head = { n: chunks.length, sum: checksum(chunks.join('')) };
  assert.equal(await decodeSnapshot({ ...head, n: head.n + 1 }, [...chunks, undefined]), null);
  assert.equal(await decodeSnapshot({ ...head, sum: 'nope' }, chunks), null);
});

test('a heavy user\'s history still fits in Chrome sync', async () => {
  const tags = ['Array', 'Hash Table', 'Two Pointers', 'Sliding Window', 'Dynamic Programming'];
  const state = { meta: {}, settings: settings(), problems: {}, reviews: {}, days: {}, attempts: [] };
  for (let i = 0; i < 600; i++) {
    const slug = `problem-number-${i}-with-a-longish-slug`;
    state.problems[slug] = {
      slug, title: `Problem Number ${i} With A Longish Title`, frontendId: String(i), difficulty: 'Medium',
      topicTags: tags.map((name) => ({ name, slug: name.toLowerCase().replace(/ /g, '-') })),
      hiddenTags: [], originSite: null, neetcodeOnly: false,
      firstSolvedAt: 1.7e12 + i * 1e6, lastSolvedAt: 1.7e12 + i * 2e6, solveCount: 2, modAt: 1.7e12 + i,
    };
    state.reviews[slug] = {
      slug, stage: i % 9, dueOn: '2026-11-01', lastReviewedAt: 1.7e12 + i, needsReview: false, modAt: 1.7e12 + i,
      history: Array.from({ length: 8 }, (_, j) => ({ on: `2026-0${(j % 9) + 1}-1${j}`, action: 'done', stage: j })),
    };
  }
  for (let i = 0; i < 365; i++) {
    state.days[`2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}x${i}`] = { attempts: 3, accepted: 2, solved: 2, slugs: ['problem-number-1-with-a-longish-slug', 'problem-number-2-with-a-longish-slug'] };
  }
  for (let i = 0; i < 3000; i++) {
    state.attempts.push({ id: String(1e9 + i), slug: `problem-number-${i % 600}-with-a-longish-slug`, at: 1.7e12 + i * 1e5, day: '2026-10-01', verdict: 'Accepted', lang: 'python3', runtimeMs: 50, memoryKb: 17000, source: 'leetcode-live' });
  }
  const { chunks } = await fitSnapshot(state, encodeSnapshot);
  assert.ok(chunks.length <= MAX_CHUNKS);
});

test('toSnapshot keeps only the most recent attempts', () => {
  const attempts = Array.from({ length: 10 }, (_, i) => ({ id: String(i), at: i }));
  assert.deepEqual(toSnapshot({ attempts }, 3).attempts.map((a) => a.id), ['7', '8', '9']);
  assert.deepEqual(toSnapshot({ attempts }, 0).attempts, []);
});

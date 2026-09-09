// Integration cover for the day window as it actually runs: through
// chrome.storage, with the migration that re-files history recorded under the
// old midnight boundary. `chrome` is stubbed with a plain object store.
import test from 'node:test';
import assert from 'node:assert/strict';

const TZ = 'America/Los_Angeles';
const store = {};

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const names = keys == null ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys]);
        return Object.fromEntries(names.filter((n) => n in store).map((n) => [n, store[n]]));
      },
      async set(obj) { Object.assign(store, obj); },
      async remove(keys) { for (const n of (Array.isArray(keys) ? keys : [keys])) delete store[n]; },
    },
  },
};

const {
  KEYS, readAll, saveSettings, syncDayWindow, recordSubmission, reviewAction, setNeedsReview,
  setRetired, defaultSettings,
} = await import('../src/lib/storage.js');

// 01:30 local on Sep 3 in LA.
const lateNight = Date.parse('2026-09-03T08:30:00Z');
const afternoon = Date.parse('2026-09-02T22:00:00Z');

function seedMidnightHistory({ dayStartHour } = {}) {
  for (const k of Object.keys(store)) delete store[k];
  store[KEYS.settings] = {
    timezone: TZ,
    intervals: [1, 3, 7, 14, 30, 60, 120],
    ...(dayStartHour === undefined ? {} : { dayStartHour }),
  };
  store[KEYS.attempts] = [
    { id: 'a1', slug: 'two-sum', at: afternoon, day: '2026-09-02', verdict: 'Accepted' },
    { id: 'a2', slug: 'lru-cache', at: lateNight, day: '2026-09-03', verdict: 'Accepted' },
  ];
  store[KEYS.days] = {
    '2026-09-02': { attempts: 1, accepted: 1, solved: 1, slugs: ['two-sum'] },
    '2026-09-03': { attempts: 1, accepted: 1, solved: 1, slugs: ['lru-cache'] },
  };
  store[KEYS.problems] = {
    'two-sum': { slug: 'two-sum', title: 'Two Sum', lastSolvedAt: afternoon, solveCount: 1 },
    'lru-cache': { slug: 'lru-cache', title: 'LRU Cache', lastSolvedAt: lateNight, solveCount: 1 },
  };
  store[KEYS.reviews] = {};
  // No meta: exactly what an install from before day windows looks like.
}

test('a day starts at 2am by default', () => {
  assert.equal(defaultSettings().dayStartHour, 2);
});

test('problem links open on LeetCode by default', () => {
  assert.equal(defaultSettings().linkSite, 'leetcode');
});

test('upgrading re-files history recorded under the old midnight boundary', async () => {
  seedMidnightHistory();

  const res = await syncDayWindow();
  assert.equal(res.changed, true);
  assert.equal(res.moved, 1);

  const { days, attempts, meta } = await readAll();
  // The 1:30am solve now belongs to the session that was still running.
  assert.deepEqual(Object.keys(days), ['2026-09-02']);
  assert.equal(days['2026-09-02'].solved, 2);
  assert.deepEqual(attempts.map((a) => a.day), ['2026-09-02', '2026-09-02']);
  assert.equal(meta.dayWindowHour, 2);
  assert.equal(meta.dayWindowTz, TZ);
});

test('the migration runs once, not on every load', async () => {
  seedMidnightHistory();
  await syncDayWindow();
  const second = await syncDayWindow();
  assert.deepEqual(second, { changed: false, moved: 0 });
});

test('changing the window in settings re-files history again', async () => {
  seedMidnightHistory();
  await syncDayWindow();

  await saveSettings({ dayStartHour: 0 });
  const res = await syncDayWindow();
  assert.equal(res.changed, true);
  const { days } = await readAll();
  assert.deepEqual(Object.keys(days).sort(), ['2026-09-02', '2026-09-03']);
});

test('a new solve at 1am lands on the day before', async () => {
  seedMidnightHistory();
  await syncDayWindow();

  await recordSubmission({
    id: 'live-1', slug: 'coin-change', title: 'Coin Change',
    at: Date.parse('2026-09-04T08:00:00Z'), // 01:00 on the 4th in LA
    verdict: 'Accepted', source: 'test',
  });

  const { days, reviews } = await readAll();
  assert.equal('2026-09-04' in days, false);
  assert.equal(days['2026-09-03'].solved, 1);
  // The review ladder starts from the day it was filed under, not the clock date.
  assert.equal(reviews['coin-change'].dueOn, '2026-09-04');
});

test('delay, skip and the needs-review flag round-trip through storage', async () => {
  seedMidnightHistory();
  await syncDayWindow();
  store[KEYS.reviews] = {
    'two-sum': { slug: 'two-sum', stage: 2, dueOn: '2026-09-02', lastReviewedAt: null, history: [] },
  };

  const delayed = await reviewAction('two-sum', 'delay', { days: 4 });
  assert.equal(delayed.stage, 2);
  assert.equal(delayed.history.at(-1).days, 4);

  const flagged = await setNeedsReview('two-sum', true);
  assert.equal(flagged.needsReview, true);

  const skipped = await reviewAction('two-sum', 'skip');
  assert.equal(skipped.stage, 2);
  assert.equal(skipped.needsReview, true); // skipping isn't reviewing
  assert.equal((await setNeedsReview('two-sum', false)).needsReview, false);
});

test('flagging a problem that has no review row schedules one', async () => {
  seedMidnightHistory();
  await syncDayWindow();
  const r = await setNeedsReview('lru-cache', true);
  assert.equal(r.needsReview, true);
  assert.equal(r.slug, 'lru-cache');
  assert.equal((await readAll()).reviews['lru-cache'].needsReview, true);
});

test('flagging something never solved does nothing', async () => {
  seedMidnightHistory();
  assert.equal(await setNeedsReview('not-a-problem', true), null);
});

test('removing a problem from review keeps it as practised', async () => {
  seedMidnightHistory();
  await syncDayWindow();
  store[KEYS.reviews] = {
    'two-sum': { slug: 'two-sum', stage: 1, dueOn: '2026-09-02', lastReviewedAt: null, history: [] },
  };

  const retired = await setRetired('two-sum', true);
  assert.equal(retired.retired, true);

  const { problems, reviews, days } = await readAll();
  // Off the schedule...
  assert.equal(reviews['two-sum'].retired, true);
  // ...but still solved, still in the rollup, still in the history.
  assert.equal(problems['two-sum'].solveCount, 1);
  assert.equal(days['2026-09-02'].solved, 2);
});

test('re-solving a removed problem does not put it back on the schedule', async () => {
  seedMidnightHistory();
  await syncDayWindow();
  store[KEYS.reviews] = {
    'two-sum': { slug: 'two-sum', stage: 1, dueOn: '2026-09-02', lastReviewedAt: null, history: [] },
  };
  await setRetired('two-sum', true);

  // The whole reason the row is kept rather than deleted: `recordSubmission`
  // only schedules a problem it has never seen.
  await recordSubmission({
    id: 'again-1', slug: 'two-sum', at: Date.parse('2026-09-10T20:00:00Z'),
    verdict: 'Accepted', source: 'test',
  });

  const { reviews, problems } = await readAll();
  assert.equal(reviews['two-sum'].retired, true);
  assert.equal(problems['two-sum'].solveCount, 2);
});

test('restore puts it back and the round trip is stable', async () => {
  seedMidnightHistory();
  await syncDayWindow();
  store[KEYS.reviews] = {
    'two-sum': { slug: 'two-sum', stage: 1, dueOn: '2026-09-02', lastReviewedAt: null, history: [] },
  };
  await setRetired('two-sum', true);
  const back = await setRetired('two-sum', false);
  assert.equal(back.retired, false);
  assert.equal(back.stage, 1);
  assert.equal((await readAll()).reviews['two-sum'].retired, false);
});

test('removing something never solved does nothing', async () => {
  seedMidnightHistory();
  assert.equal(await setRetired('not-a-problem', true), null);
});

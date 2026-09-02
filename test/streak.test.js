import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStreak, activeDayKeys } from '../src/lib/streak.js';

const solved = (...keys) => Object.fromEntries(keys.map((k) => [k, { solved: 1, attempts: 1, accepted: 1 }]));

test('counts a run ending today', () => {
  const s = computeStreak(solved('2026-09-01', '2026-09-02', '2026-09-03'), '2026-09-03');
  assert.equal(s.current, 3);
  assert.equal(s.solvedToday, true);
});

test('an empty today does not break the streak yet', () => {
  // Nothing solved today, but yesterday's run is still alive until the day ends.
  const s = computeStreak(solved('2026-09-01', '2026-09-02'), '2026-09-03');
  assert.equal(s.current, 2);
  assert.equal(s.solvedToday, false);
});

test('a full missed day breaks it', () => {
  const s = computeStreak(solved('2026-09-01', '2026-09-02'), '2026-09-04');
  assert.equal(s.current, 0);
});

test('longest survives a later gap', () => {
  const s = computeStreak(
    solved('2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-09-02', '2026-09-03'),
    '2026-09-03',
  );
  assert.equal(s.current, 2);
  assert.equal(s.longest, 4);
  assert.equal(s.activeDays, 6);
});

test('longest is never less than current', () => {
  const s = computeStreak(solved('2026-09-01', '2026-09-02', '2026-09-03'), '2026-09-03');
  assert.equal(s.longest, 3);
});

test('toRecord counts days needed to beat the record', () => {
  // Matches the screenshot: current 2, longest 2 -> "1 day away from a new record".
  const s = computeStreak(solved('2026-09-02', '2026-09-03'), '2026-09-03');
  assert.equal(s.current, 2);
  assert.equal(s.longest, 2);
  assert.equal(s.toRecord, 1);
});

test('days with attempts but no solve are not active', () => {
  const days = { '2026-09-02': { attempts: 5, accepted: 0, solved: 0 } };
  assert.deepEqual(activeDayKeys(days), []);
  assert.equal(computeStreak(days, '2026-09-02').current, 0);
});

test('empty history is zeroed, not NaN', () => {
  const s = computeStreak({}, '2026-09-03');
  assert.deepEqual([s.current, s.longest, s.activeDays], [0, 0, 0]);
});

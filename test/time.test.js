import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, addDays, diffDays, windowKeys, monthDays, shiftMonth, weekdayOf } from '../src/lib/time.js';

test('dayKey respects the timezone, not UTC', () => {
  // 2026-09-02T20:30Z is already the 3rd in Kolkata (+05:30) and still the 2nd in LA.
  const t = new Date('2026-09-02T20:30:00Z');
  assert.equal(dayKey(t, 'Asia/Kolkata'), '2026-09-03');
  assert.equal(dayKey(t, 'America/Los_Angeles'), '2026-09-02');
  assert.equal(dayKey(t, 'UTC'), '2026-09-02');
});

test('a late-night solve lands on the local day, not the UTC one', () => {
  // 22:00 on Sep 2 in Los Angeles is already Sep 3 in UTC. Slicing an ISO
  // string would file the solve on the wrong day and break the streak.
  const t = new Date('2026-09-03T05:00:00Z');
  assert.equal(dayKey(t, 'America/Los_Angeles'), '2026-09-02');
  assert.equal(t.toISOString().slice(0, 10), '2026-09-03');
  assert.notEqual(t.toISOString().slice(0, 10), dayKey(t, 'America/Los_Angeles'));
});

test('addDays crosses months and years', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29'); // leap year
});

test('addDays is DST-proof', () => {
  // US spring-forward and fall-back weekends must still be exactly one day apart.
  assert.equal(addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(diffDays('2026-03-07', '2026-03-09'), 2);
});

test('diffDays is signed', () => {
  assert.equal(diffDays('2026-09-01', '2026-09-05'), 4);
  assert.equal(diffDays('2026-09-05', '2026-09-01'), -4);
  assert.equal(diffDays('2026-09-05', '2026-09-05'), 0);
});

test('windowKeys returns n keys ending inclusive', () => {
  const w = windowKeys('2026-09-03', 14);
  assert.equal(w.length, 14);
  assert.equal(w[0], '2026-08-21');
  assert.equal(w[13], '2026-09-03');
});

test('monthDays handles February and 30-day months', () => {
  assert.equal(monthDays('2026-02').length, 28);
  assert.equal(monthDays('2024-02').length, 29);
  assert.equal(monthDays('2026-09').length, 30);
  assert.equal(monthDays('2026-09')[0], '2026-09-01');
});

test('shiftMonth wraps the year', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('weekdayOf matches the calendar', () => {
  assert.equal(weekdayOf('2026-09-02'), 3); // a Wednesday
});

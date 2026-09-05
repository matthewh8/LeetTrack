import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKey, todayKey, addDays, diffDays, windowKeys, monthDays, shiftMonth, weekdayOf,
  hourLabel, normaliseHour,
} from '../src/lib/time.js';

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

test('a 2am day window keeps a late-night solve on the day it started', () => {
  const TZ = 'America/Los_Angeles';
  // 01:30 local on Sep 3 — still "Sep 2" to anyone who never went to bed.
  const lateNight = new Date('2026-09-03T08:30:00Z');
  assert.equal(dayKey(lateNight, TZ), '2026-09-03');
  assert.equal(dayKey(lateNight, TZ, 2), '2026-09-02');

  // 02:00 exactly is the new day; 01:59 is not.
  assert.equal(dayKey(new Date('2026-09-03T09:00:00Z'), TZ, 2), '2026-09-03');
  assert.equal(dayKey(new Date('2026-09-03T08:59:00Z'), TZ, 2), '2026-09-02');
});

test('the day window only shifts the hours below it', () => {
  const TZ = 'UTC';
  assert.equal(dayKey(new Date('2026-09-03T02:00:00Z'), TZ, 2), '2026-09-03');
  assert.equal(dayKey(new Date('2026-09-03T12:00:00Z'), TZ, 2), '2026-09-03');
  assert.equal(dayKey(new Date('2026-09-03T23:59:00Z'), TZ, 2), '2026-09-03');
  assert.equal(dayKey(new Date('2026-09-03T00:00:00Z'), TZ, 2), '2026-09-02');
});

test('a shifted window crosses months and years cleanly', () => {
  assert.equal(dayKey(new Date('2026-10-01T00:30:00Z'), 'UTC', 2), '2026-09-30');
  assert.equal(dayKey(new Date('2026-01-01T01:00:00Z'), 'UTC', 2), '2025-12-31');
});

test('the window is applied to the wall clock, not by subtracting hours', () => {
  // US spring-forward: 2026-03-08 in New York has no 02:00-02:59 local hour.
  // 03:30 local (07:30Z) is past a 2am start, so it must stay on the 8th —
  // rewinding two real hours would land it at 00:30 and file it on the 7th.
  const TZ = 'America/New_York';
  assert.equal(dayKey(new Date('2026-03-08T07:30:00Z'), TZ, 2), '2026-03-08');
  assert.equal(dayKey(new Date('2026-03-08T06:30:00Z'), TZ, 2), '2026-03-07'); // 01:30 EST
});

test('todayKey passes the window through', () => {
  const at = new Date('2026-09-03T08:30:00Z');
  assert.equal(todayKey('America/Los_Angeles', 0, at), '2026-09-03');
  assert.equal(todayKey('America/Los_Angeles', 2, at), '2026-09-02');
});

test('normaliseHour rejects anything unusable', () => {
  assert.equal(normaliseHour(2), 2);
  assert.equal(normaliseHour('5'), 5);
  assert.equal(normaliseHour(0), 0);
  assert.equal(normaliseHour(23), 23);
  assert.equal(normaliseHour(24, 2), 2);
  assert.equal(normaliseHour(-1, 2), 2);
  assert.equal(normaliseHour('abc', 2), 2);
  assert.equal(normaliseHour(undefined, 2), 2);
});

test('hourLabel reads like a clock', () => {
  assert.equal(hourLabel(0), '12:00 AM');
  assert.equal(hourLabel(2), '2:00 AM');
  assert.equal(hourLabel(12), '12:00 PM');
  assert.equal(hourLabel(20), '8:00 PM');
});

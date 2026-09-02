import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_INTERVALS, intervalAt, scheduleFirst, applyReview, dueBy, dueCountsByDay, parseIntervals,
} from '../src/lib/scheduler.js';

const I = DEFAULT_INTERVALS; // 1,3,7,14,30,60,120

test('first solve is due one day later', () => {
  const r = scheduleFirst('two-sum', '2026-09-02', I);
  assert.equal(r.dueOn, '2026-09-03');
  assert.equal(r.stage, 0);
});

test('done walks the interval ladder', () => {
  let r = scheduleFirst('two-sum', '2026-09-02', I);
  r = applyReview(r, 'done', '2026-09-03', I); // stage 1 -> +3
  assert.equal(r.dueOn, '2026-09-06');
  r = applyReview(r, 'done', '2026-09-06', I); // stage 2 -> +7
  assert.equal(r.dueOn, '2026-09-13');
  r = applyReview(r, 'done', '2026-09-13', I); // stage 3 -> +14
  assert.equal(r.dueOn, '2026-09-27');
  assert.equal(r.stage, 3);
});

test('past the last interval it repeats the longest one', () => {
  assert.equal(intervalAt(I, 6), 120);
  assert.equal(intervalAt(I, 99), 120);
  let r = { slug: 'x', stage: 6, dueOn: '2026-09-02', history: [] };
  r = applyReview(r, 'done', '2026-09-02', I);
  assert.equal(r.dueOn, '2026-12-31'); // +120
});

test('snooze pushes a day without advancing the stage', () => {
  const r0 = { slug: 'x', stage: 3, dueOn: '2026-09-02', lastReviewedAt: null, history: [] };
  const r = applyReview(r0, 'snooze', '2026-09-02', I);
  assert.equal(r.dueOn, '2026-09-03');
  assert.equal(r.stage, 3);
  assert.equal(r.lastReviewedAt, null); // snoozing is not reviewing
});

test('again resets to the first interval', () => {
  const r0 = { slug: 'x', stage: 5, dueOn: '2026-09-02', history: [] };
  const r = applyReview(r0, 'again', '2026-09-02', I);
  assert.equal(r.stage, 0);
  assert.equal(r.dueOn, '2026-09-03');
});

test('reviews are immutable in place', () => {
  const r0 = scheduleFirst('two-sum', '2026-09-02', I);
  const r1 = applyReview(r0, 'done', '2026-09-03', I);
  assert.equal(r0.stage, 0);
  assert.equal(r1.stage, 1);
});

test('dueBy includes overdue, oldest first', () => {
  const reviews = {
    a: { slug: 'a', dueOn: '2026-09-05', stage: 0 },
    b: { slug: 'b', dueOn: '2026-08-30', stage: 0 },
    c: { slug: 'c', dueOn: '2026-09-03', stage: 0 },
  };
  assert.deepEqual(dueBy(reviews, '2026-09-03').map((r) => r.slug), ['b', 'c']);
  assert.deepEqual(dueBy(reviews, '2026-09-10').map((r) => r.slug), ['b', 'c', 'a']);
});

test('dueCountsByDay tallies the calendar', () => {
  const reviews = {
    a: { slug: 'a', dueOn: '2026-09-09' },
    b: { slug: 'b', dueOn: '2026-09-09' },
    c: { slug: 'c', dueOn: '2026-09-13' },
  };
  assert.deepEqual(dueCountsByDay(reviews), { '2026-09-09': 2, '2026-09-13': 1 });
});

test('parseIntervals sanitises user input', () => {
  assert.deepEqual(parseIntervals('1,3,7,14,30,60,120'), I);
  assert.deepEqual(parseIntervals(' 7 , 1 ,3 '), [1, 3, 7]);        // sorted
  assert.deepEqual(parseIntervals('1,1,3'), [1, 3]);                 // deduped
  assert.deepEqual(parseIntervals('0,-4,abc,5'), [5]);               // junk dropped
  assert.deepEqual(parseIntervals(''), I);                           // falls back
  assert.deepEqual(parseIntervals('nonsense'), I);
});

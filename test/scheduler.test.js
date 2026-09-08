import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_INTERVALS, intervalAt, scheduleFirst, applyReview, setFlag, dueBy, dueCountsByDay,
  parseIntervals, flaggedReviews, normaliseDelay, activeReviews, retiredReviews,
} from '../src/lib/scheduler.js';

const I = DEFAULT_INTERVALS; // 1,3,7,14,30,60,120,240,365

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
  assert.equal(intervalAt(I, I.length - 1), 365);
  assert.equal(intervalAt(I, 99), 365);
  let r = { slug: 'x', stage: I.length - 1, dueOn: '2026-09-02', history: [] };
  r = applyReview(r, 'done', '2026-09-02', I);
  assert.equal(r.dueOn, '2027-09-02'); // +365, the ladder's last rung repeating
});

test('the ladder runs past 120 days without inventing rungs beyond a year', () => {
  assert.deepEqual(I, [1, 3, 7, 14, 30, 60, 120, 240, 365]);
  // Every rung is longer than the one before it, and none is a fluke of sorting.
  assert.deepEqual([...I].sort((a, b) => a - b), I);
  assert.equal(Math.max(...I), 365);
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

test('setFlag sets and clears without touching the schedule', () => {
  const r0 = { slug: 'x', stage: 4, dueOn: '2026-09-02', lastReviewedAt: '2026-08-30', history: [{ action: 'done', on: '2026-08-30' }] };

  const on = setFlag(r0, 'important', true);
  assert.equal(on.important, true);
  assert.equal(on.stage, 4);
  assert.equal(on.dueOn, '2026-09-02');
  assert.equal(on.lastReviewedAt, '2026-08-30');
  assert.deepEqual(on.history, r0.history); // flagging is not reviewing
  assert.equal(r0.important, undefined);    // and does not mutate in place

  assert.equal(setFlag(on, 'important', false).important, false);
  assert.equal(setFlag(r0, 'struggling', true).struggling, true);
});

test('setFlag ignores an unknown flag', () => {
  const r0 = { slug: 'x', stage: 0, dueOn: '2026-09-02', history: [] };
  assert.equal(setFlag(r0, 'nonsense', true), r0);
});

test('flags survive a review — they live on the review record', () => {
  const r0 = setFlag(scheduleFirst('two-sum', '2026-09-02', I), 'important', true);
  const r1 = applyReview(r0, 'done', '2026-09-03', I);
  assert.equal(r1.important, true);
  assert.equal(applyReview(r1, 'again', '2026-09-04', I).important, true);
});

test('dueBy leads with must-dos, then struggling, overdue-first within each', () => {
  const reviews = {
    plain: { slug: 'plain', dueOn: '2026-08-28', stage: 0 },
    star: { slug: 'star', dueOn: '2026-09-03', stage: 0, important: true },
    starLate: { slug: 'starLate', dueOn: '2026-08-30', stage: 0, important: true },
    shaky: { slug: 'shaky', dueOn: '2026-09-03', stage: 0, struggling: true },
    both: { slug: 'both', dueOn: '2026-09-03', stage: 0, important: true, struggling: true },
  };
  // both (rank 3) > starLate, star (rank 2, oldest first) > shaky (1) > plain (0),
  // even though `plain` is the most overdue thing in the list.
  assert.deepEqual(
    dueBy(reviews, '2026-09-03').map((r) => r.slug),
    ['both', 'starLate', 'star', 'shaky', 'plain'],
  );
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
  assert.deepEqual(parseIntervals('1,3,7,14,30,60,120,240,365'), I);
  assert.deepEqual(parseIntervals('1,3,7,14,30,60,120'), [1, 3, 7, 14, 30, 60, 120]);
  assert.deepEqual(parseIntervals(' 7 , 1 ,3 '), [1, 3, 7]);        // sorted
  assert.deepEqual(parseIntervals('1,1,3'), [1, 3]);                 // deduped
  assert.deepEqual(parseIntervals('0,-4,abc,5'), [5]);               // junk dropped
  assert.deepEqual(parseIntervals(''), I);                           // falls back
  assert.deepEqual(parseIntervals('nonsense'), I);
});

test('delay pushes by a custom number of days', () => {
  const r0 = { slug: 'x', stage: 3, dueOn: '2026-09-02', lastReviewedAt: null, history: [] };
  assert.equal(applyReview(r0, 'delay', '2026-09-02', I, { days: 5 }).dueOn, '2026-09-07');
  assert.equal(applyReview(r0, 'delay', '2026-09-02', I, { days: 1 }).dueOn, '2026-09-03');
  assert.equal(applyReview(r0, 'delay', '2026-09-02', I).dueOn, '2026-09-03'); // defaults to a day
  assert.equal(applyReview(r0, 'delay', '2026-09-02', I, { days: 5 }).stage, 3);
  assert.equal(applyReview(r0, 'delay', '2026-09-02', I, { days: 5 }).lastReviewedAt, null);
});

test('delaying an overdue item measures from today, not from the missed date', () => {
  const r0 = { slug: 'x', stage: 2, dueOn: '2026-08-20', history: [] };
  assert.equal(applyReview(r0, 'delay', '2026-09-02', I, { days: 1 }).dueOn, '2026-09-03');
});

test('delaying something not due yet never pulls it forward', () => {
  const r0 = { slug: 'x', stage: 2, dueOn: '2026-09-20', history: [] };
  assert.equal(applyReview(r0, 'delay', '2026-09-02', I, { days: 1 }).dueOn, '2026-09-21');
  assert.equal(applyReview(r0, 'snooze', '2026-09-02', I).dueOn, '2026-09-21');
});

test('delay records what it did in the history', () => {
  const r = applyReview({ slug: 'x', stage: 0, dueOn: '2026-09-02', history: [] },
    'delay', '2026-09-02', I, { days: 4 });
  assert.deepEqual(r.history.at(-1), { on: '2026-09-02', action: 'delay', days: 4 });
});

test('a junk delay falls back to one day rather than corrupting the date', () => {
  const r0 = { slug: 'x', stage: 0, dueOn: '2026-09-02', history: [] };
  assert.equal(applyReview(r0, 'delay', '2026-09-02', I, { days: 'abc' }).dueOn, '2026-09-03');
  assert.equal(applyReview(r0, 'delay', '2026-09-02', I, { days: 0 }).dueOn, '2026-09-03');
  assert.equal(applyReview(r0, 'delay', '2026-09-02', I, { days: -9 }).dueOn, '2026-09-03');
});

test('normaliseDelay clamps and rounds', () => {
  assert.equal(normaliseDelay('3'), 3);
  assert.equal(normaliseDelay(2.6), 3);
  assert.equal(normaliseDelay(99999), 3650);
  assert.equal(normaliseDelay(0), null);
  assert.equal(normaliseDelay(''), null);
  assert.equal(normaliseDelay('soon'), null);
});

test('skip pushes a whole cycle without moving the stage', () => {
  // stage 2 -> the 7-day interval, again, from today.
  const r0 = { slug: 'x', stage: 2, dueOn: '2026-09-02', lastReviewedAt: null, history: [] };
  const r = applyReview(r0, 'skip', '2026-09-02', I);
  assert.equal(r.dueOn, '2026-09-09');
  assert.equal(r.stage, 2);
  assert.equal(r.lastReviewedAt, null); // skipping is not reviewing
});

test('skipping is not the same as done — the ladder does not advance', () => {
  const r0 = { slug: 'x', stage: 1, dueOn: '2026-09-02', history: [] };
  assert.equal(applyReview(r0, 'skip', '2026-09-02', I).stage, 1);
  assert.equal(applyReview(r0, 'skip', '2026-09-02', I).dueOn, '2026-09-05');   // +3, stage 1 again
  assert.equal(applyReview(r0, 'done', '2026-09-02', I).stage, 2);
  assert.equal(applyReview(r0, 'done', '2026-09-02', I).dueOn, '2026-09-09');   // +7, stage 2's interval
});

test('nailing it skips a cycle: two rungs up, one rung of waiting', () => {
  // Stage 1 is the 3-day rung. Done makes it a 7-day problem due in 7 days;
  // "nailed it" makes it a 14-day problem — also due in 7, not in 14.
  const r0 = { slug: 'x', stage: 1, dueOn: '2026-09-02', lastReviewedAt: null, history: [] };

  const done = applyReview(r0, 'done', '2026-09-02', I);
  assert.equal(done.stage, 2);
  assert.equal(done.dueOn, '2026-09-09');

  const aced = applyReview(r0, 'ace', '2026-09-02', I);
  assert.equal(aced.stage, 3);            // the 14-day rung: a whole cycle skipped
  assert.equal(aced.dueOn, '2026-09-09'); // but the wait is still the 7 it earned
  assert.equal(aced.lastReviewedAt, '2026-09-02'); // unlike skip, this IS a review
});

test('acing compounds: the review after the next one is what jumps', () => {
  let r = { slug: 'x', stage: 1, dueOn: '2026-09-02', history: [] };
  r = applyReview(r, 'ace', '2026-09-02', I);   // stage 3, due +7
  r = applyReview(r, 'done', '2026-09-09', I);  // stage 4 -> the 30-day rung
  assert.equal(r.stage, 4);
  assert.equal(r.dueOn, '2026-10-09');
});

test('acing at the top of the ladder stays on the ladder', () => {
  const r0 = { slug: 'x', stage: I.length - 1, dueOn: '2026-09-02', history: [] };
  const r = applyReview(r0, 'ace', '2026-09-02', I);
  assert.equal(r.dueOn, '2027-09-02'); // +365, clamped like every other stage
  assert.equal(intervalAt(I, r.stage), 365);
});

test('acing clears the needs-review mark and records itself', () => {
  const flagged = applyReview({ slug: 'x', stage: 0, dueOn: '2026-09-02', history: [] },
    'flag', '2026-09-02', I);
  const aced = applyReview(flagged, 'ace', '2026-09-02', I);
  assert.equal(aced.needsReview, false);
  assert.deepEqual(aced.history.at(-1), { on: '2026-09-02', action: 'ace', days: 3 });
});

test('flagging surfaces a problem in the queue whatever its due date', () => {
  const far = { slug: 'far', stage: 4, dueOn: '2026-12-01', history: [] };
  const flagged = applyReview(far, 'flag', '2026-09-02', I);
  assert.equal(flagged.needsReview, true);
  assert.equal(flagged.dueOn, '2026-12-01'); // the schedule itself is untouched

  const reviews = { far: flagged, soon: { slug: 'soon', dueOn: '2026-09-01', stage: 0 } };
  assert.deepEqual(dueBy(reviews, '2026-09-02').map((r) => r.slug), ['far', 'soon']);
  assert.deepEqual(flaggedReviews(reviews).map((r) => r.slug), ['far']);
});

test('unflag takes it back out of the queue', () => {
  let r = applyReview({ slug: 'x', stage: 0, dueOn: '2026-12-01', history: [] }, 'flag', '2026-09-02', I);
  r = applyReview(r, 'unflag', '2026-09-02', I);
  assert.equal(r.needsReview, false);
  assert.deepEqual(dueBy({ x: r }, '2026-09-02'), []);
});

test('reviewing a flagged problem clears the flag', () => {
  const flagged = applyReview({ slug: 'x', stage: 1, dueOn: '2026-09-02', history: [] }, 'flag', '2026-09-02', I);
  assert.equal(applyReview(flagged, 'done', '2026-09-02', I).needsReview, false);
  assert.equal(applyReview(flagged, 'again', '2026-09-02', I).needsReview, false);
  // Delaying and skipping are not reviewing, so the mark survives them.
  assert.equal(applyReview(flagged, 'delay', '2026-09-02', I, { days: 2 }).needsReview, true);
  assert.equal(applyReview(flagged, 'skip', '2026-09-02', I).needsReview, true);
});

test('an unknown action is a no-op', () => {
  const r0 = { slug: 'x', stage: 1, dueOn: '2026-09-02', history: [] };
  assert.equal(applyReview(r0, 'nope', '2026-09-02', I), r0);
});

test('retiring takes a problem off the schedule without deleting it', () => {
  const r0 = { slug: 'two-sum', stage: 3, dueOn: '2026-09-02', history: [] };
  const r = applyReview(r0, 'retire', '2026-09-02', I);

  assert.equal(r.retired, true);
  assert.equal(r.stage, 3);       // everything it learned is kept
  assert.equal(r.dueOn, '2026-09-02');

  const reviews = { 'two-sum': r, other: { slug: 'other', dueOn: '2026-09-02', stage: 0 } };
  assert.deepEqual(dueBy(reviews, '2026-09-02').map((x) => x.slug), ['other']);
  assert.deepEqual(dueCountsByDay(reviews), { '2026-09-02': 1 });
  assert.deepEqual(activeReviews(reviews).map((x) => x.slug), ['other']);
  assert.deepEqual(retiredReviews(reviews).map((x) => x.slug), ['two-sum']);
});

test('retiring clears the needs-review mark', () => {
  const flagged = applyReview({ slug: 'x', stage: 0, dueOn: '2026-12-01', history: [] }, 'flag', '2026-09-02', I);
  const retired = applyReview(flagged, 'retire', '2026-09-02', I);
  assert.equal(retired.needsReview, false);
  // A flag must not drag a retired problem back into the queue.
  assert.deepEqual(dueBy({ x: retired }, '2026-09-02'), []);
  assert.deepEqual(flaggedReviews({ x: retired }), []);
});

test('restoring a long-retired problem brings it back due today, not months overdue', () => {
  const retired = applyReview({ slug: 'x', stage: 2, dueOn: '2026-01-05', history: [] }, 'retire', '2026-01-05', I);
  const back = applyReview(retired, 'restore', '2026-09-02', I);
  assert.equal(back.retired, false);
  assert.equal(back.dueOn, '2026-09-02');
  assert.equal(back.stage, 2);
});

test('restoring keeps a due date that is still in the future', () => {
  const retired = applyReview({ slug: 'x', stage: 2, dueOn: '2026-10-01', history: [] }, 'retire', '2026-09-02', I);
  assert.equal(applyReview(retired, 'restore', '2026-09-02', I).dueOn, '2026-10-01');
});

test('a retired problem stays off the calendar until it is restored', () => {
  const retired = applyReview({ slug: 'x', stage: 1, dueOn: '2026-09-02', history: [] }, 'retire', '2026-09-02', I);
  // Delaying or skipping one doesn't quietly put it back on the schedule.
  assert.equal(applyReview(retired, 'delay', '2026-09-02', I, { days: 3 }).retired, true);
  assert.equal(applyReview(retired, 'skip', '2026-09-02', I).retired, true);
  assert.equal(applyReview(retired, 'done', '2026-09-02', I).retired, true);
});

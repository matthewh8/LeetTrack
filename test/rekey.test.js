import test from 'node:test';
import assert from 'node:assert/strict';
import { rekeyState } from '../src/lib/rekey.js';
import { dayKey } from '../src/lib/time.js';

const TZ = 'America/Los_Angeles';

// 2026-09-03T08:30Z is 01:30 on the 3rd in LA — the case the 2am window exists
// for. 2026-09-02T22:00Z is 15:00 on the 2nd, unaffected by any window.
const lateNight = Date.parse('2026-09-03T08:30:00Z');
const afternoon = Date.parse('2026-09-02T22:00:00Z');

function midnightState() {
  return {
    attempts: [
      { id: 'a1', slug: 'two-sum', at: afternoon, day: '2026-09-02', verdict: 'Accepted' },
      { id: 'a2', slug: 'lru-cache', at: lateNight, day: '2026-09-03', verdict: 'Wrong Answer' },
      { id: 'a3', slug: 'lru-cache', at: lateNight, day: '2026-09-03', verdict: 'Accepted' },
    ],
    days: {
      '2026-09-02': { attempts: 1, accepted: 1, solved: 1, slugs: ['two-sum'] },
      '2026-09-03': { attempts: 2, accepted: 1, solved: 1, slugs: ['lru-cache'] },
    },
  };
}

test('moving to a 2am window re-files the late-night rows onto the day before', () => {
  const { attempts, days, moved } = rekeyState(midnightState(), TZ, 2);

  assert.equal(moved, 2);
  assert.deepEqual(attempts.map((a) => a.day), ['2026-09-02', '2026-09-02', '2026-09-02']);
  assert.deepEqual(days, {
    '2026-09-02': { attempts: 3, accepted: 2, solved: 2, slugs: ['two-sum', 'lru-cache'] },
  });
  // The emptied day is gone, not left behind as a phantom active day.
  assert.equal('2026-09-03' in days, false);
});

test('rekeying is idempotent — running it twice changes nothing more', () => {
  const once = rekeyState(midnightState(), TZ, 2);
  const twice = rekeyState(once, TZ, 2);
  assert.equal(twice.moved, 0);
  assert.deepEqual(twice.days, once.days);
  assert.deepEqual(twice.attempts, once.attempts);
});

test('going back to a midnight window restores the original split', () => {
  const shifted = rekeyState(midnightState(), TZ, 2);
  const back = rekeyState(shifted, TZ, 0);
  assert.deepEqual(back.days, midnightState().days);
});

test('it leaves the source state alone', () => {
  const before = midnightState();
  rekeyState(before, TZ, 2);
  assert.equal(before.attempts[1].day, '2026-09-03');
  assert.equal(before.days['2026-09-03'].attempts, 2);
});

test('rollups older than the surviving attempts are kept, not dropped', () => {
  // Attempts are capped, so history can outlive the rows that produced it.
  // Those days have no evidence to re-file and must survive untouched.
  const state = {
    attempts: [{ id: 'a1', slug: 'two-sum', at: afternoon, day: '2026-09-02', verdict: 'Accepted' }],
    days: {
      '2025-01-01': { attempts: 4, accepted: 3, solved: 3, slugs: ['a', 'b', 'c'] },
      '2026-09-02': { attempts: 1, accepted: 1, solved: 1, slugs: ['two-sum'] },
    },
  };
  const { days, rebuiltFrom } = rekeyState(state, TZ, 2);
  assert.equal(rebuiltFrom, '2026-09-02');
  assert.deepEqual(days['2025-01-01'], state.days['2025-01-01']);
  assert.deepEqual(days['2026-09-02'], { attempts: 1, accepted: 1, solved: 1, slugs: ['two-sum'] });
});

test('a timezone change re-files from the timestamp too', () => {
  const state = {
    attempts: [{ id: 'a1', slug: 'two-sum', at: afternoon, day: '2026-09-02', verdict: 'Accepted' }],
    days: { '2026-09-02': { attempts: 1, accepted: 1, solved: 1, slugs: ['two-sum'] } },
  };
  // 22:00Z on the 2nd is already the 3rd in Tokyo.
  assert.equal(dayKey(new Date(afternoon), 'Asia/Tokyo', 2), '2026-09-03');
  const { days, moved } = rekeyState(state, 'Asia/Tokyo', 2);
  assert.equal(moved, 1);
  assert.deepEqual(Object.keys(days), ['2026-09-03']);
});

test('empty history is a no-op', () => {
  const { attempts, days, moved, rebuiltFrom } = rekeyState({ attempts: [], days: {} }, TZ, 2);
  assert.deepEqual(attempts, []);
  assert.deepEqual(days, {});
  assert.equal(moved, 0);
  assert.equal(rebuiltFrom, null);
});

test('duplicate solves of one problem still count as one solved problem', () => {
  const state = {
    attempts: [
      { id: 'a1', slug: 'two-sum', at: afternoon, day: '2026-09-02', verdict: 'Accepted' },
      { id: 'a2', slug: 'two-sum', at: lateNight, day: '2026-09-03', verdict: 'Accepted' },
    ],
    days: {},
  };
  const { days } = rekeyState(state, TZ, 2);
  assert.deepEqual(days['2026-09-02'], { attempts: 2, accepted: 2, solved: 1, slugs: ['two-sum'] });
});

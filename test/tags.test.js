// Tag removal as it actually runs: through chrome.storage, against the two
// things that would quietly undo it — a re-sync rewriting `topicTags`, and
// solving the problem again. `chrome` is stubbed with a plain object store.
import test from 'node:test';
import assert from 'node:assert/strict';

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
  KEYS, readAll, recordSubmission, enrichProblem, setTagHidden, restoreTags,
} = await import('../src/lib/storage.js');
const { visibleTags, hiddenTags } = await import('../src/lib/patterns.js');

const TZ = 'America/Los_Angeles';
const at = Date.parse('2026-09-02T22:00:00Z');

function seed() {
  for (const k of Object.keys(store)) delete store[k];
  store[KEYS.settings] = { timezone: TZ, dayStartHour: 2 };
  store[KEYS.problems] = {
    'add-two-numbers': {
      slug: 'add-two-numbers',
      title: 'Add Two Numbers',
      frontendId: '2',
      difficulty: 'Medium',
      topicTags: ['Linked List', 'Math', 'Recursion'],
      firstSolvedAt: at,
      lastSolvedAt: at,
      solveCount: 1,
    },
  };
  store[KEYS.days] = {};
  store[KEYS.attempts] = [];
  store[KEYS.reviews] = {};
}

const problem = async () => (await readAll()).problems['add-two-numbers'];

test('removing a tag hides it without touching what LeetCode said', async () => {
  seed();
  const next = await setTagHidden('add-two-numbers', 'Math', true);
  assert.deepEqual(next.hiddenTags, ['Math']);
  assert.deepEqual(next.topicTags, ['Linked List', 'Math', 'Recursion']);
  assert.deepEqual(visibleTags(await problem()), ['Linked List', 'Recursion']);
});

test('a re-sync re-tagging the problem does not resurrect a removed tag', async () => {
  seed();
  await setTagHidden('add-two-numbers', 'Math', true);
  // What the GraphQL backfill does on every sync.
  await enrichProblem('add-two-numbers', {
    difficulty: 'Medium',
    topicTags: ['Linked List', 'Math', 'Recursion'],
  });
  assert.deepEqual(visibleTags(await problem()), ['Linked List', 'Recursion']);
});

test('solving the problem again does not resurrect a removed tag', async () => {
  seed();
  await setTagHidden('add-two-numbers', 'Math', true);
  await recordSubmission({
    id: 'x-1', slug: 'add-two-numbers', at: Date.parse('2026-09-10T20:00:00Z'),
    verdict: 'Accepted', source: 'test',
  });
  const p = await problem();
  assert.equal(p.solveCount, 2);
  assert.deepEqual(visibleTags(p), ['Linked List', 'Recursion']);
});

test('removing is never deleting: every removed tag goes back', async () => {
  seed();
  await setTagHidden('add-two-numbers', 'Math', true);
  await setTagHidden('add-two-numbers', 'Recursion', true);
  assert.deepEqual(hiddenTags(await problem()), ['Math', 'Recursion']);

  // One at a time...
  await setTagHidden('add-two-numbers', 'Math', false);
  assert.deepEqual(visibleTags(await problem()), ['Linked List', 'Math']);
  // ...or all at once.
  await restoreTags('add-two-numbers');
  assert.deepEqual(visibleTags(await problem()), ['Linked List', 'Math', 'Recursion']);
});

test('removing the same tag twice leaves one removal, not two', async () => {
  seed();
  await setTagHidden('add-two-numbers', 'Math', true);
  const twice = await setTagHidden('add-two-numbers', 'Math', true);
  assert.deepEqual(twice.hiddenTags, ['Math']);
});

test('a tag edit on something not tracked does nothing', async () => {
  seed();
  assert.equal(await setTagHidden('not-a-problem', 'Math', true), null);
  assert.equal(await setTagHidden('add-two-numbers', '  ', true), null);
  assert.equal(await restoreTags('not-a-problem'), null);
});

test('a fresh solve starts with no removals rather than no field', async () => {
  seed();
  await recordSubmission({
    id: 'new-1', slug: 'two-sum', at, verdict: 'Accepted', title: 'Two Sum',
    topicTags: ['Array', 'Hash Table'], source: 'test',
  });
  const p = (await readAll()).problems['two-sum'];
  assert.deepEqual(p.hiddenTags, []);
  assert.deepEqual(visibleTags(p), ['Array', 'Hash Table']);
});

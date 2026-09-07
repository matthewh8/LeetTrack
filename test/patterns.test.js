import test from 'node:test';
import assert from 'node:assert/strict';
import {
  patternsFor, patternsOf, patternCounts, tagCounts, tierOf, needsEnrichment,
  visibleTags, hiddenTags, hasTag,
} from '../src/lib/patterns.js';

test('a real pattern beats the container it uses', () => {
  // Longest Substring Without Repeating Characters
  assert.deepEqual(patternsFor(['Hash Table', 'String', 'Sliding Window']), ['Sliding Window']);
  // Container With Most Water
  assert.deepEqual(patternsFor(['Array', 'Two Pointers', 'Greedy']), ['Two Pointers', 'Greedy']);
});

test('two techniques both show', () => {
  assert.deepEqual(patternsFor(['Array', 'Binary Search', 'Prefix Sum']), ['Binary Search', 'Prefix Sum']);
});

test('a generic runner-up is dropped when the top tag is a real pattern', () => {
  // "Sliding Window, Array" would be noise — the second tag adds nothing.
  assert.deepEqual(patternsFor(['Array', 'Sliding Window']), ['Sliding Window']);
});

test('all-generic tags still yield two, since neither is special', () => {
  // Two Sum: nothing here names a technique, so both containers earn their place.
  assert.deepEqual(patternsFor(['Array', 'Hash Table']), ['Array', 'Hash Table']);
});

test('never returns more than max', () => {
  const many = ['Array', 'Binary Search', 'Prefix Sum', 'Greedy', 'Sorting'];
  assert.equal(patternsFor(many).length, 2);
  assert.equal(patternsFor(many, 1).length, 1);
  assert.equal(patternsFor(many, 3).length, 3);
});

test('handles missing, empty, and junk tags', () => {
  assert.deepEqual(patternsFor(undefined), []);
  assert.deepEqual(patternsFor([]), []);
  assert.deepEqual(patternsFor(['', '  ']), []);
  assert.deepEqual(patternsFor([null, 'Greedy']), ['Greedy']);
});

test('an unknown tag is treated as a probable technique, not a container', () => {
  assert.equal(tierOf('Some New Technique'), 2);
  assert.deepEqual(patternsFor(['Array', 'Some New Technique']), ['Some New Technique']);
});

test('ties keep the order LeetCode gave', () => {
  assert.deepEqual(patternsFor(['Prefix Sum', 'Binary Search']), ['Prefix Sum', 'Binary Search']);
});

test('patternCounts ranks by how often a pattern was practised', () => {
  const problems = {
    a: { topicTags: ['Array', 'Sliding Window'] },
    b: { topicTags: ['String', 'Sliding Window'] },
    c: { topicTags: ['Array', 'Two Pointers'] },
    d: { topicTags: [] },
  };
  const counts = patternCounts(problems);
  assert.deepEqual(counts[0], { tag: 'Sliding Window', count: 2, tier: 1 });
  assert.deepEqual(counts.map((c) => c.tag), ['Sliding Window', 'Two Pointers']);
});

test('patternCounts ignores untagged problems rather than inventing a bucket', () => {
  assert.deepEqual(patternCounts({ a: { topicTags: [] }, b: {} }), []);
});

test('needsEnrichment finds what the sync still owes: tags, difficulty, number', () => {
  const problems = {
    a: { slug: 'a', topicTags: ['Greedy'], difficulty: 'Easy', frontendId: '1' },
    b: { slug: 'b', topicTags: [], difficulty: 'Easy', frontendId: '2' },
    c: { slug: 'c', topicTags: ['Greedy'], difficulty: null, frontendId: '3' },
    d: { slug: 'd', topicTags: ['Greedy'], difficulty: 'Hard', frontendId: null },
  };
  assert.deepEqual(needsEnrichment(problems), ['b', 'c', 'd']);
  assert.equal(needsEnrichment(problems, 1).length, 1);
});

test('a structure tag is what the problem is about, and it shows', () => {
  // The complaint this fixes: a linked-list problem whose chips said
  // "Recursion" — true of half of LeetCode, and not what you searched for.
  assert.deepEqual(patternsFor(['Linked List', 'Math', 'Recursion']), ['Linked List', 'Recursion']);
  assert.deepEqual(patternsFor(['Hash Table', 'Linked List', 'Design', 'Doubly-Linked List']),
    ['Linked List', 'Design']);
  assert.deepEqual(patternsFor(['String', 'Stack']), ['Stack']);
  assert.deepEqual(patternsFor(['Array', 'Matrix', 'Simulation']), ['Matrix']);
  // A named algorithm still outranks the structure it runs on.
  assert.deepEqual(patternsFor(['Linked List', 'Two Pointers']), ['Two Pointers', 'Linked List']);
});

test('a removed tag is gone from the chips, the counts, and the filter', () => {
  const problem = { topicTags: ['Array', 'Hash Table', 'Greedy'], hiddenTags: ['Greedy'] };
  assert.deepEqual(visibleTags(problem), ['Array', 'Hash Table']);
  assert.deepEqual(patternsOf(problem), ['Array', 'Hash Table']);
  assert.equal(hasTag(problem, 'Greedy'), false);
  assert.equal(hasTag(problem, 'Array'), true);
  assert.deepEqual(patternCounts({ a: problem }).map((c) => c.tag), ['Array', 'Hash Table']);
  assert.deepEqual(tagCounts({ a: problem }).map((c) => c.tag), ['Array', 'Hash Table']);
});

test('removing tags never loses them — they are listed to be put back', () => {
  const problem = { topicTags: ['Array', 'Greedy'], hiddenTags: ['Greedy', 'Stale Tag'] };
  // Only tags the problem still has: a stale removal from an old tag list is
  // not offered for restore, because restoring it would put back nothing.
  assert.deepEqual(hiddenTags(problem), ['Greedy']);
  assert.deepEqual(problem.topicTags, ['Array', 'Greedy']); // untouched
});

test('a problem with every tag removed simply has none', () => {
  const problem = { topicTags: ['Array'], hiddenTags: ['Array'] };
  assert.deepEqual(patternsOf(problem), []);
  assert.deepEqual(patternCounts({ a: problem }), []);
});

test('tagCounts offers every tag in play, not just the surfaced ones', () => {
  // "Add Two Numbers" surfaces Linked List and Recursion; Math is still a tag
  // you can filter by, and still a group these problems belong to.
  const problems = {
    a: { topicTags: ['Linked List', 'Math', 'Recursion'] },
    b: { topicTags: ['Math', 'Dynamic Programming'] },
  };
  assert.deepEqual(tagCounts(problems).map((c) => `${c.tag}:${c.count}`),
    ['Math:2', 'Dynamic Programming:1', 'Linked List:1', 'Recursion:1']);
  assert.deepEqual(patternCounts(problems).map((c) => c.tag),
    ['Dynamic Programming', 'Linked List', 'Recursion']);
});

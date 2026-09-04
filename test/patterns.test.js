import test from 'node:test';
import assert from 'node:assert/strict';
import { patternsFor, patternCounts, tierOf, untaggedSlugs } from '../src/lib/patterns.js';

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

test('untaggedSlugs finds what the sync still needs to enrich', () => {
  const problems = {
    a: { slug: 'a', topicTags: ['Greedy'], difficulty: 'Easy' },
    b: { slug: 'b', topicTags: [], difficulty: 'Easy' },
    c: { slug: 'c', topicTags: ['Greedy'], difficulty: null },
  };
  assert.deepEqual(untaggedSlugs(problems), ['b', 'c']);
  assert.equal(untaggedSlugs(problems, 1).length, 1);
});

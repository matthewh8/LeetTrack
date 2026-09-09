import test from 'node:test';
import assert from 'node:assert/strict';
import { problemUrl } from '../src/lib/links.js';

test('defaults to leetcode.com when no host or site is set', () => {
  assert.equal(problemUrl('two-sum'), 'https://leetcode.com/problems/two-sum/');
});

test('links to the host you are signed into', () => {
  assert.equal(problemUrl('two-sum', 'leetcode.cn'), 'https://leetcode.cn/problems/two-sum/');
});

test('linkSite "neetcode" points at neetcode.io regardless of host', () => {
  assert.equal(problemUrl('two-sum', 'leetcode.cn', 'neetcode'), 'https://neetcode.io/problems/two-sum');
});

test('any other linkSite value falls back to the LeetCode host', () => {
  assert.equal(problemUrl('two-sum', 'leetcode.com', 'bogus'), 'https://leetcode.com/problems/two-sum/');
});

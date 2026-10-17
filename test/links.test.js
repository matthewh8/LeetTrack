import test from 'node:test';
import assert from 'node:assert/strict';
import { problemUrl } from '../src/lib/links.js';

test('defaults to leetcode.com when no host is known', () => {
  assert.equal(problemUrl('two-sum'), 'https://leetcode.com/problems/two-sum/');
});

test('links to the host you are signed into', () => {
  assert.equal(problemUrl('two-sum', 'leetcode.cn'), 'https://leetcode.cn/problems/two-sum/');
});

test('a renamed NeetCode slug links to NeetCode with no flags set', () => {
  assert.equal(
    problemUrl('count-connected-components', 'leetcode.com', {}),
    'https://neetcode.io/problems/count-connected-components/question',
  );
});

test('a problem LeetCode has no page for links to NeetCode', () => {
  assert.equal(
    problemUrl('some-neetcode-original', 'leetcode.com', { neetcodeOnly: true }),
    'https://neetcode.io/problems/some-neetcode-original/question',
  );
});

test('a shared slug solved on NeetCode links back to NeetCode', () => {
  assert.equal(
    problemUrl('climbing-stairs', 'leetcode.com', { originSite: 'neetcode' }),
    'https://neetcode.io/problems/climbing-stairs/question',
  );
});

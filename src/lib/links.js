// Where a problem link points: the site the problem belongs to. One tracked
// under a NeetCode slug (`count-connected-components`), one LeetCode has no
// page for, or one you solved on NeetCode opens on NeetCode; everything else
// opens on the LeetCode host you're signed into.
import { isNeetCodeSlug } from './neetcode-slugs.js';

const NEETCODE_HOST = 'neetcode.io';

export function problemUrl(slug, host, problem) {
  const neetcode = isNeetCodeSlug(slug)
    || problem?.neetcodeOnly
    || problem?.originSite === 'neetcode';
  if (neetcode) return `https://${NEETCODE_HOST}/problems/${slug}/question`;
  return `https://${host || 'leetcode.com'}/problems/${slug}/`;
}

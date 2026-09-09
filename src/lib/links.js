// Where a problem link points. NeetCode hosts most of its practice set under
// the same slug LeetCode uses for that problem, so switching sites is just a
// different host — no slug translation table to keep in sync.
const NEETCODE_HOST = 'neetcode.io';

export function problemUrl(slug, host, linkSite) {
  if (linkSite === 'neetcode') return `https://${NEETCODE_HOST}/problems/${slug}`;
  return `https://${host || 'leetcode.com'}/problems/${slug}/`;
}

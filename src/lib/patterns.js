// Turning LeetCode's topic tags into something worth tracking.
//
// LeetCode tags every problem, but the tags mix two very different things:
// the *technique* that solves it (Sliding Window, Monotonic Stack) and the
// *container* it happens to use (Array, String, Hash Table). Raw, the generic
// ones dominate — "Two Sum: Array, Hash Table" tells you nothing about what
// skill you practised.
//
// So we rank tags by how much they say about approach, and surface the best
// few. Tier 1 is a named algorithmic pattern, tier 2 a traversal or a data
// structure you had to actually work in, tier 3 a vague catch-all, tier 4 the
// near-meaningless containers. Anything unlisted lands in tier 2 — a tag we
// don't know is more likely a real technique than another word for "Array".
//
// The structures live in tier 2 on purpose. "Linked List" is not decoration:
// a linked-list problem is a linked-list problem, and burying that tag under
// "Recursion" (which is how *every* second problem is solved) loses the one
// word you would have searched for.

const TIER = new Map();
const put = (tier, names) => names.forEach((n) => TIER.set(n, tier));

put(1, [
  'Sliding Window', 'Two Pointers', 'Binary Search', 'Dynamic Programming',
  'Backtracking', 'Greedy', 'Divide and Conquer', 'Union Find', 'Topological Sort',
  'Monotonic Stack', 'Monotonic Queue', 'Prefix Sum', 'Bit Manipulation',
  'Memoization', 'Quickselect', 'Line Sweep', 'Rolling Hash', 'String Matching',
  'Shortest Path', 'Minimum Spanning Tree', 'Strongly Connected Component',
  'Biconnected Component', 'Eulerian Circuit', 'Suffix Array', 'Game Theory',
  'Reservoir Sampling', 'Rejection Sampling', 'Bitmask',
]);

put(2, [
  // Structures: what the problem is *about*, however it happens to be solved.
  'Linked List', 'Doubly-Linked List', 'Tree', 'Binary Tree', 'Binary Search Tree',
  'N-ary Tree', 'Graph', 'Stack', 'Queue', 'Matrix', 'Heap (Priority Queue)',
  'Trie', 'Segment Tree', 'Binary Indexed Tree', 'Ordered Set', 'Data Stream',
  // Traversals and the rest of the "how" tags.
  'Depth-First Search', 'Breadth-First Search', 'Recursion', 'Sorting',
  'Merge Sort', 'Bucket Sort', 'Counting Sort', 'Radix Sort',
  'Design', 'Iterator', 'Geometry', 'Number Theory', 'Combinatorics',
  'Probability and Statistics', 'Enumeration', 'Randomized', 'Interactive',
  'Concurrency', 'Hash Function',
]);

put(3, ['Simulation', 'Brainteaser', 'Counting']);

put(4, ['Array', 'String', 'Hash Table', 'Math', 'Database', 'Shell']);

const DEFAULT_TIER = 2;

export function tierOf(tag) {
  return TIER.get(tag) ?? DEFAULT_TIER;
}

/**
 * The tags on a problem, minus any the user has removed by hand.
 *
 * Removal is per problem and never deletes: `hiddenTags` sits alongside the
 * fetched `topicTags`, so a re-sync can overwrite the tags from LeetCode
 * without resurrecting the ones you took off.
 */
export function visibleTags(problem) {
  const hidden = new Set(problem?.hiddenTags || []);
  return (problem?.topicTags || [])
    .filter((t) => typeof t === 'string' && t.trim() && !hidden.has(t));
}

export function hiddenTags(problem) {
  const tags = new Set(problem?.topicTags || []);
  return (problem?.hiddenTags || []).filter((t) => tags.has(t));
}

/**
 * The best few tags to show for a problem.
 *
 * A runner-up is only earned when it also says something about approach
 * (tier <= 2). When the best tag is already generic, the rest are added too —
 * two containers at least narrow it down more than one does.
 */
export function patternsFor(tags, max = 2) {
  const list = (tags || []).filter((t) => typeof t === 'string' && t.trim());
  if (!list.length) return [];

  const sorted = list
    .map((tag, i) => ({ tag, tier: tierOf(tag), i }))
    .sort((a, b) => a.tier - b.tier || a.i - b.i);

  const out = [sorted[0].tag];
  for (let k = 1; k < sorted.length && out.length < max; k += 1) {
    const cand = sorted[k];
    if (cand.tier <= 2 || sorted[0].tier >= 3) out.push(cand.tag);
    else break;
  }
  return out;
}

/** The chips for a stored problem: its surfaced patterns, minus removed tags. */
export function patternsOf(problem, max = 2) {
  return patternsFor(visibleTags(problem), max);
}

/**
 * How many solved problems fall under each pattern, most-practised first.
 * A problem contributes to each of its surfaced patterns, so counts can sum
 * to more than the number of problems — that's intended, not double counting.
 */
export function patternCounts(problems) {
  const counts = new Map();
  for (const p of Object.values(problems)) {
    for (const tag of patternsOf(p)) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count, tier: tierOf(tag) }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Every tag in play, not just the surfaced ones — what the group filter offers.
 * Filtering on "Linked List" has to find a problem whose chips show something
 * else, or the filter would only ever agree with the chips it was drawn from.
 */
export function tagCounts(problems) {
  const counts = new Map();
  for (const p of Object.values(problems)) {
    for (const tag of visibleTags(p)) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count, tier: tierOf(tag) }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** True when the problem carries `tag` (removed tags don't count). */
export function hasTag(problem, tag) {
  return visibleTags(problem).includes(tag);
}

/**
 * Problems the sync still has homework on: no tags, no difficulty, or no
 * problem number. Live capture sees none of the three — they only arrive from
 * GraphQL — so this is what the backfill walks through, a few per sync.
 */
export function needsEnrichment(problems, limit = 10) {
  return Object.values(problems)
    .filter((p) => !p.topicTags?.length || !p.difficulty || !p.frontendId)
    .slice(0, limit)
    .map((p) => p.slug);
}

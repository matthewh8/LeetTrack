// Turning LeetCode's topic tags into something worth tracking.
//
// LeetCode tags every problem, but the tags mix two very different things:
// the *technique* that solves it (Sliding Window, Monotonic Stack) and the
// *container* it happens to use (Array, String, Hash Table). Raw, the generic
// ones dominate — "Two Sum: Array, Hash Table" tells you nothing about what
// skill you practised.
//
// So we rank tags by how much they say about approach, and surface the best
// one or two. Tier 1 is a named algorithmic pattern, tier 2 a traversal or
// structure that implies an approach, tier 3 a plain container, tier 4 the
// near-meaningless ones. Anything unlisted lands in tier 2 — a tag we don't
// know is more likely a real technique than another word for "Array".

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
  'Depth-First Search', 'Breadth-First Search', 'Recursion', 'Sorting',
  'Merge Sort', 'Bucket Sort', 'Counting Sort', 'Radix Sort', 'Heap (Priority Queue)',
  'Trie', 'Segment Tree', 'Binary Indexed Tree', 'Binary Search Tree',
  'Ordered Set', 'Doubly-Linked List', 'Design', 'Data Stream', 'Iterator',
  'Geometry', 'Number Theory', 'Combinatorics', 'Probability and Statistics',
  'Enumeration', 'Randomized', 'Interactive', 'Concurrency', 'Hash Function',
]);

put(3, ['Linked List', 'Tree', 'Graph', 'Stack', 'Queue', 'Matrix', 'Simulation', 'Brainteaser', 'Counting']);

put(4, ['Array', 'String', 'Hash Table', 'Math', 'Database', 'Shell']);

const DEFAULT_TIER = 2;

export function tierOf(tag) {
  return TIER.get(tag) ?? DEFAULT_TIER;
}

/**
 * The one or two tags worth showing for a problem.
 *
 * A second tag is only earned when it also says something about approach
 * (tier <= 2). When the best tag is already generic, the runner-up is added
 * too — two containers at least narrow it down more than one does.
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

/**
 * How many solved problems fall under each pattern, most-practised first.
 * A problem contributes to each of its surfaced patterns, so counts can sum
 * to more than the number of problems — that's intended, not double counting.
 */
export function patternCounts(problems) {
  const counts = new Map();
  for (const p of Object.values(problems)) {
    for (const tag of patternsFor(p.topicTags)) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count, tier: tierOf(tag) }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Problems solved whose tags we haven't fetched yet — the sync backfills these. */
export function untaggedSlugs(problems, limit = 10) {
  return Object.values(problems)
    .filter((p) => !p.topicTags?.length || !p.difficulty)
    .slice(0, limit)
    .map((p) => p.slug);
}

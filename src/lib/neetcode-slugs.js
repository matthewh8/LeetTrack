// NeetCode's own slugs for problems LeetCode files under a different one.
//
// NeetCode reuses LeetCode's slug for most of its set, but renamed a good part
// of the NeetCode 150 ("count-connected-components" is LeetCode's
// "number-of-connected-components-in-an-undirected-graph"). A slug on the left
// has no LeetCode page under that name, so:
//   - links for it go to NeetCode, and
//   - its number, difficulty and categories are looked up on LeetCode under
//     the slug on the right.
// Only renamed problems are listed; a slug both sites share needs no entry.
// A NeetCode-only slug missing from here still works: the sync asks LeetCode
// about it and marks it NeetCode-only when LeetCode has never heard of it.

export const NEETCODE_TO_LEETCODE = {
  // Arrays & hashing
  'duplicate-integer': 'contains-duplicate',
  'is-anagram': 'valid-anagram',
  'two-integer-sum': 'two-sum',
  'anagram-groups': 'group-anagrams',
  'top-k-elements-in-list': 'top-k-frequent-elements',
  'string-encode-and-decode': 'encode-and-decode-strings',
  'products-of-array-discluding-self': 'product-of-array-except-self',
  // Two pointers
  'is-palindrome': 'valid-palindrome',
  'two-integer-sum-ii': 'two-sum-ii-input-array-is-sorted',
  'three-integer-sum': '3sum',
  'max-water-container': 'container-with-most-water',
  // Sliding window
  'buy-and-sell-crypto': 'best-time-to-buy-and-sell-stock',
  'longest-substring-without-duplicates': 'longest-substring-without-repeating-characters',
  'longest-repeating-substring-with-replacement': 'longest-repeating-character-replacement',
  'permutation-string': 'permutation-in-string',
  'minimum-window-with-characters': 'minimum-window-substring',
  // Stack
  'validate-parentheses': 'valid-parentheses',
  'minimum-stack': 'min-stack',
  // Binary search
  'search-2d-matrix': 'search-a-2d-matrix',
  'eating-bananas': 'koko-eating-bananas',
  'find-target-in-rotated-sorted-array': 'search-in-rotated-sorted-array',
  // Linked list
  'reverse-a-linked-list': 'reverse-linked-list',
  'merge-two-sorted-linked-lists': 'merge-two-sorted-lists',
  'reorder-linked-list': 'reorder-list',
  'remove-node-from-end-of-linked-list': 'remove-nth-node-from-end-of-list',
  'linked-list-cycle-detection': 'linked-list-cycle',
  'find-duplicate-integer': 'find-the-duplicate-number',
  'merge-k-sorted-linked-lists': 'merge-k-sorted-lists',
  // Trees
  'invert-a-binary-tree': 'invert-binary-tree',
  'depth-of-binary-tree': 'maximum-depth-of-binary-tree',
  'binary-tree-diameter': 'diameter-of-binary-tree',
  'same-binary-tree': 'same-tree',
  'subtree-of-a-binary-tree': 'subtree-of-another-tree',
  'lowest-common-ancestor-in-binary-search-tree': 'lowest-common-ancestor-of-a-binary-search-tree',
  'level-order-traversal-of-binary-tree': 'binary-tree-level-order-traversal',
  'valid-binary-search-tree': 'validate-binary-search-tree',
  'kth-smallest-integer-in-bst': 'kth-smallest-element-in-a-bst',
  'binary-tree-from-preorder-and-inorder-traversal': 'construct-binary-tree-from-preorder-and-inorder-traversal',
  // Tries
  'implement-prefix-tree': 'implement-trie-prefix-tree',
  'design-word-search-data-structure': 'design-add-and-search-words-data-structure',
  'search-for-word-ii': 'word-search-ii',
  // Heap
  'kth-largest-integer-in-a-stream': 'kth-largest-element-in-a-stream',
  'task-scheduling': 'task-scheduler',
  'design-twitter-feed': 'design-twitter',
  'find-median-in-a-data-stream': 'find-median-from-data-stream',
  // Backtracking
  'combination-target-sum': 'combination-sum',
  'combination-target-sum-ii': 'combination-sum-ii',
  'search-for-word': 'word-search',
  'combinations-of-a-phone-number': 'letter-combinations-of-a-phone-number',
  // Graphs
  'count-number-of-islands': 'number-of-islands',
  'islands-and-treasure': 'walls-and-gates',
  'rotting-fruit': 'rotting-oranges',
  'valid-tree': 'graph-valid-tree',
  'count-connected-components': 'number-of-connected-components-in-an-undirected-graph',
  'reconstruct-flight-path': 'reconstruct-itinerary',
  'min-cost-to-connect-points': 'min-cost-to-connect-all-points',
  'foreign-dictionary': 'alien-dictionary',
  'cheapest-flight-path': 'cheapest-flights-within-k-stops',
  // Dynamic programming
  'count-paths': 'unique-paths',
  'buy-and-sell-crypto-with-cooldown': 'best-time-to-buy-and-sell-stock-with-cooldown',
  'longest-increasing-path-in-matrix': 'longest-increasing-path-in-a-matrix',
  'count-subsequences': 'distinct-subsequences',
  // Greedy & intervals
  'merge-triplets-to-form-target': 'merge-triplets-to-form-target-triplet',
  'insert-new-interval': 'insert-interval',
  'meeting-schedule': 'meeting-rooms',
  'meeting-schedule-ii': 'meeting-rooms-ii',
  'minimum-interval-including-query': 'minimum-interval-to-include-each-query',
  // Math & bits
  'rotate-matrix': 'rotate-image',
  'set-zeroes-in-matrix': 'set-matrix-zeroes',
  'non-cyclical-number': 'happy-number',
  'pow-x-n': 'powx-n',
  'count-squares': 'detect-squares',
  'number-of-one-bits': 'number-of-1-bits',
};

/** The slug LeetCode knows this problem by (itself when the sites agree). */
export function leetcodeSlugFor(slug) {
  return NEETCODE_TO_LEETCODE[slug] || slug;
}

/** True for a NeetCode slug that LeetCode files under another name. */
export function isNeetCodeSlug(slug) {
  return Object.hasOwn(NEETCODE_TO_LEETCODE, slug);
}

// Derived statistics for the dashboard. Pure: no chrome.*, no Date.now().

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

export function difficultyCounts(problems) {
  const counts = { Easy: 0, Medium: 0, Hard: 0, Unknown: 0 };
  for (const p of Object.values(problems)) {
    const d = DIFFICULTIES.includes(p.difficulty) ? p.difficulty : 'Unknown';
    counts[d] += 1;
  }
  counts.total = Object.keys(problems).length;
  return counts;
}

export function recentSolves(problems, limit = 8) {
  return Object.values(problems)
    .filter((p) => p.lastSolvedAt)
    .sort((a, b) => b.lastSolvedAt - a.lastSolvedAt)
    .slice(0, limit);
}

/** Buckets a day's solve count into a 0..4 heatmap intensity level. */
export function heatLevel(solved) {
  if (!solved) return 0;
  if (solved === 1) return 1;
  if (solved <= 3) return 2;
  if (solved <= 5) return 3;
  return 4;
}

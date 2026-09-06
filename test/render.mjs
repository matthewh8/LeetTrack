// Renders the dashboard and popup against a seeded chrome.storage stub and
// writes screenshots. Not a unit test — a look-at-it check for layout,
// contrast, and overflow, which the palette validator cannot see.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const OUT = process.env.OUT_DIR || join(ROOT, 'shots');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  try {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------- fixture ----------
const TZ = 'America/Los_Angeles';
const key = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const shift = (k, n) => {
  const [y, m, d] = k.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};
const today = key(new Date());

const NAMES = [
  ['two-sum', 'Two Sum', 'Easy', ['Array', 'Hash Table']],
  ['add-two-numbers', 'Add Two Numbers', 'Medium', ['Linked List', 'Math', 'Recursion']],
  ['longest-substring-without-repeating-characters', 'Longest Substring Without Repeating Characters', 'Medium', ['Hash Table', 'String', 'Sliding Window']],
  ['median-of-two-sorted-arrays', 'Median of Two Sorted Arrays', 'Hard', ['Array', 'Binary Search', 'Divide and Conquer']],
  ['valid-parentheses', 'Valid Parentheses', 'Easy', ['String', 'Stack']],
  ['merge-k-sorted-lists', 'Merge k Sorted Lists', 'Hard', ['Linked List', 'Heap (Priority Queue)', 'Divide and Conquer', 'Merge Sort']],
  ['course-schedule', 'Course Schedule', 'Medium', ['Depth-First Search', 'Breadth-First Search', 'Graph', 'Topological Sort']],
  ['lru-cache', 'LRU Cache', 'Medium', ['Hash Table', 'Linked List', 'Design', 'Doubly-Linked List']],
  ['word-ladder', 'Word Ladder', 'Hard', ['Hash Table', 'String', 'Breadth-First Search']],
  ['climbing-stairs', 'Climbing Stairs', 'Easy', ['Math', 'Dynamic Programming', 'Memoization']],
  ['coin-change', 'Coin Change', 'Medium', ['Array', 'Dynamic Programming', 'Breadth-First Search']],
  ['number-of-islands', 'Number of Islands', 'Medium', ['Depth-First Search', 'Breadth-First Search', 'Union Find', 'Matrix']],
  ['best-time-to-buy-and-sell-stock', 'Best Time to Buy and Sell Stock', 'Easy', ['Array', 'Dynamic Programming']],
  ['trapping-rain-water', 'Trapping Rain Water', 'Hard', ['Array', 'Two Pointers', 'Dynamic Programming', 'Monotonic Stack']],
  ['binary-search', 'Binary Search', 'Easy', ['Array', 'Binary Search']],
  ['product-of-array-except-self', 'Product of Array Except Self', 'Medium', ['Array', 'Prefix Sum']],
  ['validate-binary-search-tree', 'Validate Binary Search Tree', 'Medium', ['Tree', 'Depth-First Search', 'Binary Search Tree']],
  ['serialize-and-deserialize-binary-tree', 'Serialize and Deserialize Binary Tree', 'Hard', ['Tree', 'Depth-First Search', 'Breadth-First Search', 'Design']],
  ['minimum-window-substring', 'Minimum Window Substring', 'Hard', ['Hash Table', 'String', 'Sliding Window']],
  ['longest-repeating-character-replacement', 'Longest Repeating Character Replacement', 'Medium', ['Hash Table', 'String', 'Sliding Window']],
  ['3sum', '3Sum', 'Medium', ['Array', 'Two Pointers', 'Sorting']],
  ['container-with-most-water', 'Container With Most Water', 'Medium', ['Array', 'Two Pointers', 'Greedy']],
];

let seed = 20260902;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const days = {}, problems = {}, reviews = {}, attempts = [];
let idc = 1, nameI = 0;

for (let i = 181; i >= 0; i -= 1) {
  const k = shift(today, -i);
  // A believable practice pattern: mostly-on weekdays, a dead patch, then a live streak.
  const dead = i > 120 && i < 140;
  const active = !dead && (i <= 6 || rnd() < 0.55);
  if (!active) continue;

  const n = 1 + (rnd() < 0.25 ? 1 : 0) + (rnd() < 0.08 ? 1 : 0);
  const slugs = [];
  let att = 0, acc = 0;
  for (let j = 0; j < n; j += 1) {
    const [slug, title, difficulty, topicTags] = NAMES[nameI++ % NAMES.length];
    const wrong = rnd() < 0.45 ? Math.ceil(rnd() * 2) : 0;
    const at = Date.parse(`${k}T18:0${j}:00Z`);
    for (let w = 0; w < wrong; w += 1) {
      attempts.push({ id: `s${idc++}`, slug, at, day: k, verdict: 'Wrong Answer', source: 'fixture' });
      att += 1;
    }
    attempts.push({ id: `s${idc++}`, slug, at, day: k, verdict: 'Accepted', lang: 'Python3', source: 'fixture' });
    att += 1; acc += 1;
    slugs.push(slug);
    const prev = problems[slug];
    problems[slug] = {
      slug, title, difficulty,
      frontendId: String(nameI), topicTags,
      firstSolvedAt: prev?.firstSolvedAt || at,
      lastSolvedAt: at,
      solveCount: (prev?.solveCount || 0) + 1,
    };
  }
  days[k] = { attempts: att, accepted: acc, solved: new Set(slugs).size, slugs: [...new Set(slugs)] };
}

// Reviews: a couple overdue, a few today, several spread across the month.
const solvedSlugs = Object.keys(problems);
const dueOffsets = [-3, -1, 0, 0, 1, 2, 4, 6, 9, 13, 18, 24];
solvedSlugs.slice(0, dueOffsets.length).forEach((slug, i) => {
  reviews[slug] = { slug, stage: i % 4, dueOn: shift(today, dueOffsets[i]), lastReviewedAt: null, needsReview: false, history: [] };
});
// One problem marked "needs review" by hand: it is due weeks out but still has
// to show at the top of today's queue.
if (solvedSlugs[10]) reviews[solvedSlugs[10]].needsReview = true;
// Two taken off the schedule entirely — still solved, just not scheduled.
solvedSlugs.slice(12, 14).forEach((slug, i) => {
  reviews[slug] = { slug, stage: 2, dueOn: shift(today, -40 + i), lastReviewedAt: null, retired: true, history: [] };
});

const fixture = {
  'leettrack:v1:meta': {
    schemaVersion: 1, username: 'matthewh8', host: 'leetcode.com', signedIn: true,
    lastSyncAt: Date.now() - 3600e3, dayWindowHour: 2, dayWindowTz: TZ,
  },
  'leettrack:v1:problems': problems,
  'leettrack:v1:attempts': attempts.slice(-5000),
  'leettrack:v1:days': days,
  'leettrack:v1:reviews': reviews,
  'leettrack:v1:settings': {
    timezone: TZ, intervals: [1, 3, 7, 14, 30, 60, 120],
    dailyReminder: true, reminderHour: 20, dayStartHour: 2, theme: 'system',
  },
};

// ---------- render ----------
// The session's preinstalled Chromium may not match this Playwright's expected
// build, so point at it explicitly rather than triggering a download.
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--force-color-profile=srgb', '--font-render-hinting=none'],
});
const errors = [];

async function shot(path, file, { width, height, dark, full, open }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    colorScheme: dark ? 'dark' : 'light',
    deviceScaleFactor: 2,
  });
  await ctx.addInitScript(`(() => {
    const store = ${JSON.stringify(fixture)};
    const norm = (k) => k == null ? Object.keys(store) : (Array.isArray(k) ? k : [k]);
    window.chrome = {
      storage: { local: {
        get: async (k) => Object.fromEntries(norm(k).filter((n) => n in store).map((n) => [n, store[n]])),
        set: async (o) => { Object.assign(store, o); },
        remove: async (k) => { for (const n of norm(k)) delete store[n]; },
      } },
      runtime: { sendMessage: async () => ({ ok: true, imported: 0 }), openOptionsPage() {}, getURL: (p) => p, lastError: null },
      alarms: { create() {}, clear: async () => {}, onAlarm: { addListener() {} } },
      notifications: { create() {}, onClicked: { addListener() {} } },
    };
  })();`);

  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${file}] ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`[${file}] request failed: ${r.url()}`));
  page.on('response', (r) => {
    // favicon.ico is requested by the browser chrome, not by our page.
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`[${file}] ${r.status()} ${r.url()}`);
  });
  await page.goto(`${base}/${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(350);

  // Layout guard: the page must never scroll sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) errors.push(`[${file}] horizontal overflow of ${overflow}px`);

  if (open) {
    await page.click(open);
    await page.waitForTimeout(250);
  }

  await page.screenshot({ path: join(OUT, file), fullPage: !!full });
  await ctx.close();
}

mkdirSync(OUT, { recursive: true });
await shot('src/ui/dashboard.html', 'dashboard-light.png', { width: 1280, height: 1400, dark: false, full: true });
await shot('src/ui/dashboard.html', 'dashboard-dark.png', { width: 1280, height: 1400, dark: true, full: true });
await shot('src/ui/dashboard.html', 'dashboard-narrow.png', { width: 560, height: 1000, dark: false, full: true });
await shot('src/ui/dashboard.html', 'settings.png', { width: 900, height: 760, dark: false, open: '#btn-settings' });
await shot('src/ui/dashboard.html', 'row-menu.png', { width: 1100, height: 900, dark: true, open: '.q-item .menu > summary' });
await shot('src/ui/popup.html', 'popup-dark.png', { width: 340, height: 300, dark: true });

await browser.close();
server.close();

if (errors.length) {
  console.error('Render problems:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}
console.log(`rendered 6 screenshots into ${OUT}`);

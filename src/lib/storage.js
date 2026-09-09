// The only module that touches chrome.storage. Everything else works on plain
// objects so it stays testable and portable.

import { dayKey, localTimeZone, isValidTimeZone, normaliseHour } from './time.js';
import { DEFAULT_INTERVALS, scheduleFirst, applyReview, setFlag, parseIntervals } from './scheduler.js';
import { pruneState } from './prune.js';
import { rekeyState } from './rekey.js';

const NS = 'leettrack:v1:';
export const KEYS = {
  meta: `${NS}meta`,
  problems: `${NS}problems`,
  attempts: `${NS}attempts`,
  days: `${NS}days`,
  reviews: `${NS}reviews`,
  settings: `${NS}settings`,
};

export const SCHEMA_VERSION = 1;
const ATTEMPT_CAP = 5000;

// A day rolls over at 2am, not midnight: a problem solved at 1am belongs to the
// session that's still going, not to the day that just started.
export const DEFAULT_DAY_START_HOUR = 2;

export function defaultSettings() {
  return {
    timezone: localTimeZone(),
    intervals: [...DEFAULT_INTERVALS],
    dailyReminder: true,
    reminderHour: 20,
    // Hour (0-23, local) at which one day becomes the next.
    dayStartHour: DEFAULT_DAY_START_HOUR,
    theme: 'system',
    // Which site problem links open on. 'neetcode' points at neetcode.io
    // instead of the host you're signed into.
    linkSite: 'leetcode',
    // Inclusive "YYYY-MM-DD" start of tracked history; null = track everything.
    trackFrom: null,
  };
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function normaliseDayKey(value) {
  const key = String(value ?? '').trim();
  if (!DAY_KEY.test(key)) return null;
  // Rejects 2026-02-31 and friends, which the regex alone would let through.
  return dayKey(new Date(`${key}T12:00:00Z`), 'UTC') === key ? key : null;
}

function withDefaults(stored) {
  const s = { ...defaultSettings(), ...(stored || {}) };
  if (!isValidTimeZone(s.timezone)) s.timezone = localTimeZone();
  s.intervals = parseIntervals(Array.isArray(s.intervals) ? s.intervals.join(',') : s.intervals);
  s.reminderHour = normaliseHour(s.reminderHour, 20);
  s.dayStartHour = normaliseHour(s.dayStartHour, DEFAULT_DAY_START_HOUR);
  s.trackFrom = normaliseDayKey(s.trackFrom);
  return s;
}

async function get(keys) {
  return chrome.storage.local.get(keys);
}

export async function readAll() {
  const raw = await get(Object.values(KEYS));
  return {
    meta: raw[KEYS.meta] || { schemaVersion: SCHEMA_VERSION },
    problems: raw[KEYS.problems] || {},
    attempts: raw[KEYS.attempts] || [],
    days: raw[KEYS.days] || {},
    reviews: raw[KEYS.reviews] || {},
    settings: withDefaults(raw[KEYS.settings]),
  };
}

export async function getSettings() {
  const raw = await get(KEYS.settings);
  return withDefaults(raw[KEYS.settings]);
}

export async function saveSettings(patch) {
  const next = withDefaults({ ...(await getSettings()), ...patch });
  await chrome.storage.local.set({ [KEYS.settings]: next });
  return next;
}

export async function patchMeta(patch) {
  const raw = await get(KEYS.meta);
  const next = { schemaVersion: SCHEMA_VERSION, ...(raw[KEYS.meta] || {}), ...patch };
  await chrome.storage.local.set({ [KEYS.meta]: next });
  return next;
}

/**
 * Record one submission. Idempotent on `id`, so the live interceptor and the
 * GraphQL backfill can both report the same solve without double-counting.
 *
 * @param {{id:string, slug:string, title?:string, at:number, verdict:string,
 *          lang?:string, runtimeMs?:number, memoryKb?:number, source:string,
 *          difficulty?:string, frontendId?:string, topicTags?:Array}} sub
 * @returns {Promise<{added:boolean, firstSolve:boolean}>}
 */
export async function recordSubmission(sub) {
  if (!sub || !sub.slug || !sub.id) return { added: false, firstSolve: false };

  const state = await readAll();
  const { settings } = state;

  if (state.attempts.some((a) => a.id === sub.id)) {
    return { added: false, firstSolve: false };
  }

  const at = sub.at || Date.now();
  const key = dayKey(new Date(at), settings.timezone, settings.dayStartHour);
  const accepted = sub.verdict === 'Accepted';

  // History starts at `trackFrom`. The GraphQL backfill always reports the last
  // 20 accepted solves, so without this the pruned ones would return on the
  // next sync.
  if (settings.trackFrom && key < settings.trackFrom) {
    return { added: false, firstSolve: false, skipped: 'before-track-from' };
  }

  const attempt = {
    id: sub.id,
    slug: sub.slug,
    at,
    day: key,
    verdict: sub.verdict || 'Unknown',
    lang: sub.lang || null,
    runtimeMs: sub.runtimeMs ?? null,
    memoryKb: sub.memoryKb ?? null,
    source: sub.source || 'unknown',
  };

  const attempts = [...state.attempts, attempt]
    .sort((a, b) => a.at - b.at)
    .slice(-ATTEMPT_CAP);

  // Day rollup. `slugs` holds the distinct problems accepted that day so the
  // heatmap and streak stay O(days) instead of scanning every attempt.
  const day = state.days[key] || { attempts: 0, accepted: 0, solved: 0, slugs: [] };
  const slugs = new Set(day.slugs || []);
  if (accepted) slugs.add(sub.slug);
  const days = {
    ...state.days,
    [key]: {
      attempts: day.attempts + 1,
      accepted: day.accepted + (accepted ? 1 : 0),
      solved: slugs.size,
      slugs: [...slugs],
    },
  };

  const problems = { ...state.problems };
  const reviews = { ...state.reviews };
  let firstSolve = false;

  if (accepted) {
    const prev = problems[sub.slug];
    firstSolve = !prev;
    problems[sub.slug] = {
      slug: sub.slug,
      title: sub.title || prev?.title || sub.slug,
      frontendId: sub.frontendId || prev?.frontendId || null,
      difficulty: sub.difficulty || prev?.difficulty || null,
      topicTags: sub.topicTags || prev?.topicTags || [],
      // Tags removed by hand survive every later solve and every re-sync.
      hiddenTags: prev?.hiddenTags || [],
      firstSolvedAt: prev?.firstSolvedAt || at,
      lastSolvedAt: Math.max(prev?.lastSolvedAt || 0, at),
      solveCount: (prev?.solveCount || 0) + 1,
    };
    if (!reviews[sub.slug]) {
      reviews[sub.slug] = scheduleFirst(sub.slug, key, settings.intervals);
    }
  }

  await chrome.storage.local.set({
    [KEYS.attempts]: attempts,
    [KEYS.days]: days,
    [KEYS.problems]: problems,
    [KEYS.reviews]: reviews,
  });

  return { added: true, firstSolve };
}

/** Fill in difficulty/title/tags learned after the fact from GraphQL. */
export async function enrichProblem(slug, fields) {
  const raw = await get(KEYS.problems);
  const problems = raw[KEYS.problems] || {};
  if (!problems[slug]) return false;
  problems[slug] = { ...problems[slug], ...fields };
  await chrome.storage.local.set({ [KEYS.problems]: problems });
  return true;
}

/**
 * Take a wrong tag off a problem, or put it back.
 *
 * LeetCode's tags are not always the ones you'd have chosen, and a tag you
 * disagree with skews the patterns breakdown and the group filter for as long
 * as it sits there. Removal is a per-problem overlay rather than an edit to
 * `topicTags`: the next sync overwrites what LeetCode said without undoing
 * what you said about it, and nothing is ever actually lost.
 */
export async function setTagHidden(slug, tag, hidden) {
  const name = String(tag ?? '').trim();
  if (!name) return null;
  const raw = await get(KEYS.problems);
  const problems = raw[KEYS.problems] || {};
  const problem = problems[slug];
  if (!problem) return null;

  const current = new Set(problem.hiddenTags || []);
  if (hidden) current.add(name);
  else current.delete(name);

  const next = { ...problem, hiddenTags: [...current] };
  await chrome.storage.local.set({ [KEYS.problems]: { ...problems, [slug]: next } });
  return next;
}

/** Put every removed tag back on one problem. */
export async function restoreTags(slug) {
  const raw = await get(KEYS.problems);
  const problems = raw[KEYS.problems] || {};
  const problem = problems[slug];
  if (!problem?.hiddenTags?.length) return problem || null;
  const next = { ...problem, hiddenTags: [] };
  await chrome.storage.local.set({ [KEYS.problems]: { ...problems, [slug]: next } });
  return next;
}

export async function reviewAction(slug, action, opts = {}) {
  const { reviews, settings } = await readAll();
  const review = reviews[slug];
  if (!review) return null;
  const today = dayKey(new Date(), settings.timezone, settings.dayStartHour);
  const next = applyReview(review, action, today, settings.intervals, opts);
  await chrome.storage.local.set({ [KEYS.reviews]: { ...reviews, [slug]: next } });
  return next;
}

/**
 * Toggle the "needs review" flag from anywhere a problem is listed, not just
 * from the queue. A solved problem always has a review row, but an imported or
 * pruned one may not, so schedule it here rather than silently doing nothing.
 */
export async function setNeedsReview(slug, on) {
  const { reviews, problems, settings } = await readAll();
  if (!reviews[slug] && !problems[slug]) return null;
  const today = dayKey(new Date(), settings.timezone, settings.dayStartHour);
  const review = reviews[slug] || scheduleFirst(slug, today, settings.intervals);
  const next = applyReview(review, on ? 'flag' : 'unflag', today, settings.intervals);
  await chrome.storage.local.set({ [KEYS.reviews]: { ...reviews, [slug]: next } });
  return next;
}

/**
 * Toggle `important` or `struggling`. These ride on the review rather than the
 * problem because `recordSubmission` rebuilds each problem from a fixed field
 * list, which would wipe them on the next re-solve. Reviews are only ever
 * spread, so flags survive solves, prunes, and export/import untouched.
 */
export async function setReviewFlag(slug, flag, value) {
  const { reviews } = await readAll();
  const review = reviews[slug];
  if (!review) return null;
  const next = setFlag(review, flag, value);
  await chrome.storage.local.set({ [KEYS.reviews]: { ...reviews, [slug]: next } });
  return next;
}

/**
 * Take a problem off the review schedule, or put it back. The row is kept
 * rather than deleted: `recordSubmission` only schedules a problem it has
 * never seen, so deleting the review would quietly resurrect it the next time
 * the problem was solved. The problem itself stays in every other count — it
 * was still practised.
 */
export async function setRetired(slug, on) {
  const { reviews, problems, settings } = await readAll();
  if (!reviews[slug] && !problems[slug]) return null;
  const today = dayKey(new Date(), settings.timezone, settings.dayStartHour);
  const review = reviews[slug] || scheduleFirst(slug, today, settings.intervals);
  const next = applyReview(review, on ? 'retire' : 'restore', today, settings.intervals);
  await chrome.storage.local.set({ [KEYS.reviews]: { ...reviews, [slug]: next } });
  return next;
}

/**
 * Re-file history when the day window (or timezone) changed since it was
 * recorded. Cheap and idempotent: the applied window is stamped in meta, so
 * this is a two-key read and nothing else on every call but the first.
 */
export async function syncDayWindow() {
  const settings = await getSettings();
  const raw = await get([KEYS.meta, KEYS.attempts, KEYS.days]);
  const meta = raw[KEYS.meta] || {};
  const appliedHour = Number.isInteger(meta.dayWindowHour) ? meta.dayWindowHour : 0;
  const appliedTz = meta.dayWindowTz || settings.timezone;

  if (appliedHour === settings.dayStartHour && appliedTz === settings.timezone) {
    return { changed: false, moved: 0 };
  }

  const { attempts, days, moved } = rekeyState(
    { attempts: raw[KEYS.attempts] || [], days: raw[KEYS.days] || {} },
    settings.timezone,
    settings.dayStartHour,
  );

  await chrome.storage.local.set({ [KEYS.attempts]: attempts, [KEYS.days]: days });
  await patchMeta({
    dayWindowHour: settings.dayStartHour,
    dayWindowTz: settings.timezone,
    dayWindowAt: Date.now(),
  });
  return { changed: true, moved };
}

export async function exportAll() {
  const state = await readAll();
  return {
    format: 'leettrack-export',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: state,
  };
}

export async function importAll(payload, { merge = false } = {}) {
  const incoming = payload?.data;
  if (!incoming || typeof incoming !== 'object') {
    throw new Error('Not a LeetTrack export file.');
  }
  if (payload.format !== 'leettrack-export') {
    throw new Error('Unrecognised export format.');
  }

  const current = merge ? await readAll() : null;
  const pick = (name, empty) => {
    const next = incoming[name] ?? empty;
    if (!merge) return next;
    return Array.isArray(empty) ? [...current[name], ...next] : { ...current[name], ...next };
  };

  await chrome.storage.local.set({
    [KEYS.problems]: pick('problems', {}),
    [KEYS.days]: pick('days', {}),
    [KEYS.reviews]: pick('reviews', {}),
    [KEYS.attempts]: (pick('attempts', []) || []).slice(-ATTEMPT_CAP),
    [KEYS.settings]: withDefaults(incoming.settings),
    [KEYS.meta]: {
      schemaVersion: SCHEMA_VERSION,
      importedAt: Date.now(),
      // What the incoming rows were keyed under, not what we now want: an
      // export from before day windows existed is midnight-keyed, and
      // `syncDayWindow` re-files it on the next call.
      dayWindowHour: normaliseHour(incoming.settings?.dayStartHour, 0),
      dayWindowTz: incoming.settings?.timezone || undefined,
    },
  });
}

/**
 * Delete everything before `fromKey` and stop accepting solves older than it.
 * Returns the per-collection counts removed, or null if `fromKey` is unusable.
 */
export async function resetHistoryFrom(fromKey) {
  const from = normaliseDayKey(fromKey);
  if (!from) return null;

  const current = await readAll();
  const { state, removed } = pruneState(
    current, from, current.settings.timezone, current.settings.dayStartHour,
  );

  await chrome.storage.local.set({
    [KEYS.problems]: state.problems,
    [KEYS.attempts]: state.attempts,
    [KEYS.days]: state.days,
    [KEYS.reviews]: state.reviews,
    [KEYS.settings]: withDefaults({ ...current.settings, trackFrom: from }),
  });
  await patchMeta({ historyResetAt: Date.now(), trackFrom: from });

  return removed;
}

export async function clearAll() {
  await chrome.storage.local.remove(Object.values(KEYS));
}

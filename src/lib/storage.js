// The only module that touches chrome.storage. Everything else works on plain
// objects so it stays testable and portable.

import { dayKey, localTimeZone, isValidTimeZone } from './time.js';
import { DEFAULT_INTERVALS, scheduleFirst, applyReview, parseIntervals } from './scheduler.js';

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

export function defaultSettings() {
  return {
    timezone: localTimeZone(),
    intervals: [...DEFAULT_INTERVALS],
    dailyReminder: true,
    reminderHour: 20,
    theme: 'system',
  };
}

function withDefaults(stored) {
  const s = { ...defaultSettings(), ...(stored || {}) };
  if (!isValidTimeZone(s.timezone)) s.timezone = localTimeZone();
  s.intervals = parseIntervals(Array.isArray(s.intervals) ? s.intervals.join(',') : s.intervals);
  s.reminderHour = Math.min(23, Math.max(0, Number(s.reminderHour) || 20));
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
  const key = dayKey(new Date(at), settings.timezone);
  const accepted = sub.verdict === 'Accepted';

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

export async function reviewAction(slug, action) {
  const { reviews, settings } = await readAll();
  const review = reviews[slug];
  if (!review) return null;
  const today = dayKey(new Date(), settings.timezone);
  const next = applyReview(review, action, today, settings.intervals);
  await chrome.storage.local.set({ [KEYS.reviews]: { ...reviews, [slug]: next } });
  return next;
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
    [KEYS.meta]: { schemaVersion: SCHEMA_VERSION, importedAt: Date.now() },
  });
}

export async function clearAll() {
  await chrome.storage.local.remove(Object.values(KEYS));
}

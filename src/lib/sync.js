// Merging two devices' state, and packing it into chrome.storage.sync.
//
// Each device keeps its full history in chrome.storage.local. What travels
// through chrome.storage.sync is a snapshot of it — problems, reviews, days,
// settings and the most recent attempts — gzipped and split across items,
// because sync allows ~100KB in total and 8KB per item.
//
// Conflicts resolve per record, never per snapshot: a review done on the
// laptop and a solve recorded on the desktop both survive. Every record that
// storage.js writes carries `modAt`, and the later one wins. Rows written
// before sync existed have none, so they fall back to field-wise rules.
//
// Pure: no chrome.*, no Date.now().

import { pruneState } from './prune.js';

export const SNAPSHOT_VERSION = 1;
// Attempts are the bulky part and only feed "recent" views; the full log stays
// on the device that recorded it.
export const SYNC_ATTEMPTS = 500;
const ATTEMPT_CAP = 5000;

// chrome.storage.sync: QUOTA_BYTES 102400, QUOTA_BYTES_PER_ITEM 8192.
export const CHUNK_CHARS = 7800;
export const MAX_CHUNKS = 12;

/** JSON with sorted keys, so equal state always compares equal. */
export function canonical(value) {
  return JSON.stringify(value, (_k, v) => (
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v
  ));
}

export function dayWindowOf(meta, settings) {
  const hour = Number.isInteger(meta?.dayWindowHour) ? meta.dayWindowHour : 0;
  return `${hour}|${meta?.dayWindowTz || settings?.timezone || ''}`;
}

export function toSnapshot(state, attemptLimit = SYNC_ATTEMPTS) {
  return {
    v: SNAPSHOT_VERSION,
    dayWindow: state.dayWindow ?? dayWindowOf(state.meta, state.settings),
    settings: state.settings || {},
    problems: state.problems || {},
    reviews: state.reviews || {},
    days: state.days || {},
    attempts: attemptLimit > 0 ? (state.attempts || []).slice(-attemptLimit) : [],
  };
}

const t = (r) => r?.modAt || 0;

function mergeProblem(a, b) {
  const [win, lose] = t(b) > t(a) || (t(b) === t(a) && (b.lastSolvedAt || 0) > (a.lastSolvedAt || 0))
    ? [b, a] : [a, b];
  const firsts = [win.firstSolvedAt, lose.firstSolvedAt].filter(Boolean);
  return {
    ...win,
    firstSolvedAt: firsts.length ? Math.min(...firsts) : win.firstSolvedAt,
    lastSolvedAt: Math.max(win.lastSolvedAt || 0, lose.lastSolvedAt || 0),
    solveCount: Math.max(win.solveCount || 0, lose.solveCount || 0),
  };
}

function mergeReview(a, b) {
  if (t(a) !== t(b)) return t(b) > t(a) ? b : a;
  const ha = a.history?.length || 0;
  const hb = b.history?.length || 0;
  return hb > ha || (hb === ha && (b.lastReviewedAt || 0) > (a.lastReviewedAt || 0)) ? b : a;
}

function mergeDay(a, b) {
  const slugs = [...new Set([...(a.slugs || []), ...(b.slugs || [])])];
  const out = {
    attempts: Math.max(a.attempts || 0, b.attempts || 0),
    accepted: Math.max(a.accepted || 0, b.accepted || 0, slugs.length),
    solved: slugs.length,
    slugs,
  };
  const modAt = Math.max(t(a), t(b));
  return modAt ? { ...out, modAt } : out;
}

function mergeMap(a = {}, b = {}, mergeOne) {
  const out = { ...a };
  for (const [key, value] of Object.entries(b)) {
    out[key] = key in out ? mergeOne(out[key], value) : value;
  }
  return out;
}

// A fresh install's untouched defaults lose to anything that was ever set.
function settingsTime(snap) {
  if (snap.settings?.modAt) return snap.settings.modAt;
  return Object.keys(snap.problems || {}).length ? 0 : -1;
}

/**
 * Combine the local snapshot with the remote one. `local` wins exact ties, so
 * merging a snapshot with itself (or with a stale echo of itself) is a no-op.
 */
export function mergeSnapshots(local, remote) {
  if (!remote || remote.v !== SNAPSHOT_VERSION) return local;

  const remoteSettingsWin = settingsTime(remote) > settingsTime(local);
  const settings = remoteSettingsWin ? remote.settings : local.settings;

  // Day keys depend on the day window. Rows filed under a different window
  // can't be unioned with ours, so ours stay as they are — never replaced
  // wholesale. Whichever device is behind re-files its own after picking up
  // the new settings, and the next round unions them.
  const days = local.dayWindow === remote.dayWindow
    ? mergeMap(local.days, remote.days, mergeDay)
    : local.days;

  const byId = new Map();
  for (const a of [...(local.attempts || []), ...(remote.attempts || [])]) {
    if (!byId.has(a.id)) byId.set(a.id, a);
  }
  const attempts = [...byId.values()].sort((x, y) => x.at - y.at).slice(-ATTEMPT_CAP);

  let merged = {
    v: SNAPSHOT_VERSION,
    // What `days` is filed under, which is still ours until we re-file.
    dayWindow: local.dayWindow,
    settings,
    problems: mergeMap(local.problems, remote.problems, mergeProblem),
    reviews: mergeMap(local.reviews, remote.reviews, mergeReview),
    days,
    attempts,
  };

  // One side reset its history to a start date; the union just pulled the
  // other side's older rows back in, so trim them again.
  const from = settings?.trackFrom;
  if (from && local.settings?.trackFrom !== remote.settings?.trackFrom) {
    const hour = Number(merged.dayWindow.split('|')[0]) || 0;
    const { state } = pruneState(merged, from, settings.timezone, hour);
    merged = { ...merged, ...state };
  }
  return merged;
}

/**
 * Shrink a snapshot until `encode` fits it in sync. Attempts go first, then
 * review history; problems, reviews and days themselves are never dropped.
 */
export async function fitSnapshot(state, encode) {
  const steps = [
    (s) => toSnapshot(s, SYNC_ATTEMPTS),
    (s) => toSnapshot(s, 100),
    (s) => toSnapshot(s, 0),
    (s) => {
      const snap = toSnapshot(s, 0);
      snap.reviews = Object.fromEntries(Object.entries(snap.reviews)
        .map(([k, r]) => [k, { ...r, history: (r.history || []).slice(-5) }]));
      return snap;
    },
  ];
  for (const step of steps) {
    const snap = step(state);
    const chunks = await encode(snap);
    if (chunks.length <= MAX_CHUNKS) return { snap, chunks };
  }
  throw new Error('Too much history to sync between devices (over Chrome\'s 100KB sync limit).');
}

async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Cheap checksum, to notice a half-arrived set of chunks. */
export function checksum(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export async function encodeSnapshot(snap) {
  const gz = await pipe(new TextEncoder().encode(JSON.stringify(snap)), new CompressionStream('gzip'));
  const text = toBase64(gz);
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_CHARS) chunks.push(text.slice(i, i + CHUNK_CHARS));
  return chunks;
}

/** Null when the chunks don't add up — mid-arrival, or never written. */
export async function decodeSnapshot(head, chunks) {
  if (!head || !Array.isArray(chunks) || chunks.length !== head.n) return null;
  if (chunks.some((c) => typeof c !== 'string')) return null;
  const text = chunks.join('');
  if (checksum(text) !== head.sum) return null;
  try {
    const json = await pipe(fromBase64(text), new DecompressionStream('gzip'));
    return JSON.parse(new TextDecoder().decode(json));
  } catch {
    return null;
  }
}

// Coordinates capture, backfill, and reminders.

import {
  recordSubmission, enrichProblem, readAll, getSettings, patchMeta, reviewAction, syncDayWindow,
  backfillOriginSite, markNeetCodeOnly, SYNCED_KEYS,
} from '../lib/storage.js';
import { syncDevices, SYNC_PREFIX } from '../lib/cloud.js';
import { HOSTS, fetchUserStatus, fetchRecentAccepted, fetchQuestion } from '../lib/leetcode-api.js';
import { dayKey } from '../lib/time.js';
import { dueBy } from '../lib/scheduler.js';
import { needsEnrichment } from '../lib/patterns.js';
import { leetcodeSlugFor } from '../lib/neetcode-slugs.js';

const SYNC_ALARM = 'leettrack:sync';
const REMINDER_ALARM = 'leettrack:reminder';

chrome.runtime.onInstalled.addListener(async () => {
  await patchMeta({ installedAt: Date.now() });
  await syncDayWindow().catch(() => {});
  await backfillOriginSite().catch(() => {});
  await scheduleAlarms();
  syncDevices().catch(() => {});
  enrichPending().catch(() => {});
  syncRecent().then(
    () => patchMeta({ lastSyncError: null }),
    (err) => patchMeta({ lastSyncError: err?.message || String(err), lastSyncErrorAt: Date.now() }),
  );
});

chrome.runtime.onStartup.addListener(async () => {
  await syncDayWindow().catch(() => {});
  scheduleAlarms().catch(() => {});
  syncDevices().catch(() => {});
});

// Push local edits and pull the other device's, a few seconds after the last
// change so a burst of writes (one solve touches four keys) is one round.
let deviceSyncTimer = null;
function scheduleDeviceSync(delayMs = 3000) {
  clearTimeout(deviceSyncTimer);
  deviceSyncTimer = setTimeout(() => syncDevices().catch(() => {}), delayMs);
}

chrome.storage.onChanged.addListener((changes, area) => {
  const keys = Object.keys(changes);
  if (area === 'local' && keys.some((k) => SYNCED_KEYS.includes(k))) scheduleDeviceSync();
  if (area === 'sync' && keys.some((k) => k.startsWith(SYNC_PREFIX))) scheduleDeviceSync(1000);
});

async function scheduleAlarms() {
  await chrome.alarms.clear(SYNC_ALARM);
  await chrome.alarms.clear(REMINDER_ALARM);
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 30, delayInMinutes: 1 });
  chrome.alarms.create(REMINDER_ALARM, { periodInMinutes: 60, delayInMinutes: 5 });
}

async function ensureAlarms() {
  const existing = await chrome.alarms.getAll();
  const names = existing.map((a) => a.name);
  if (!names.includes(SYNC_ALARM))
    chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 30, delayInMinutes: 1 });
  if (!names.includes(REMINDER_ALARM))
    chrome.alarms.create(REMINDER_ALARM, { periodInMinutes: 60, delayInMinutes: 5 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  ensureAlarms().catch(() => {});
  if (alarm.name === SYNC_ALARM) {
    syncRecent().then(
      () => patchMeta({ lastSyncError: null }),
      (err) => patchMeta({ lastSyncError: err?.message || String(err), lastSyncErrorAt: Date.now() }),
    );
    syncDevices().catch(() => {});
  }
  if (alarm.name === REMINDER_ALARM) maybeRemind().catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ensureAlarms().catch(() => {});
  (async () => {
    try {
      if (msg?.type === 'leettrack:submission') {
        const result = await recordSubmission(msg.submission);
        if (result.added && result.firstSolve) {
          const src = msg.submission.source || '';
          if (src.startsWith('neetcode')) {
            // In order, so LeetCode's categories land on top of NeetCode's
            // coarser topics rather than racing them.
            const slug = msg.submission.slug;
            enrichFromNeetCode(slug).catch(() => {})
              .then(() => enrichFromGraphQL(slug)).catch(() => {});
          } else {
            enrichFromGraphQL(msg.submission.slug).catch(() => {});
          }
        }
        sendResponse({ ok: true, ...result });
        return;
      }
      if (msg?.type === 'leettrack:sync') {
        const n = await syncRecent();
        await patchMeta({ lastSyncError: null });
        await syncDevices().catch(() => {});
        sendResponse({ ok: true, imported: n });
        return;
      }
      if (msg?.type === 'leettrack:enrich') {
        // Awaited so the dashboard's reload after this sees the result,
        // including a NeetCode-only mark.
        await enrichFromGraphQL(msg.slug).catch(() => {});
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === 'leettrack:review') {
        const next = await reviewAction(msg.slug, msg.action, msg.opts || {});
        sendResponse({ ok: true, review: next });
        return;
      }
      sendResponse({ ok: false, error: 'unknown message' });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // async response
});

function hostForUser(meta) {
  return HOSTS[meta?.host] || HOSTS['leetcode.com'];
}

async function enrichFromGraphQL(slug, host) {
  const { meta } = await readAll();
  const base = host || hostForUser(meta);
  // A renamed NeetCode problem is looked up under LeetCode's name for it, so
  // it gets LeetCode's number, difficulty and categories.
  const lcSlug = leetcodeSlugFor(slug);
  let q;
  try {
    q = await fetchQuestion(base, lcSlug);
  } catch (err) {
    // An unknown slug comes back as `question: null` or, sometimes, as a
    // GraphQL error saying so. Anything else — offline, signed out — is not
    // evidence either way.
    if (!/does not exist|not found/i.test(err?.message || '')) throw err;
    q = null;
  }
  // No such question on LeetCode, so this slug only exists on NeetCode.
  if (!q) {
    await markNeetCodeOnly(slug);
    return;
  }
  const renamed = lcSlug !== slug;
  await enrichProblem(slug, {
    // A renamed problem keeps NeetCode's title — it's the one you'll recognise.
    ...(renamed ? { neetcodeOnly: true, leetcodeSlug: lcSlug } : { title: q.title }),
    frontendId: q.questionFrontendId,
    difficulty: q.difficulty,
    topicTags: (q.topicTags || []).map((t) => t.name),
  });
}

async function enrichFromNeetCode(slug) {
  const res = await fetch('https://neetcode.io/api/getProblemMetadataFunctionHttp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { problemId: slug } }),
  });
  if (!res.ok) return;
  const json = await res.json();
  const d = json?.data || json?.result;
  if (!d?.name) return;
  await enrichProblem(slug, {
    title: d.name,
    difficulty: d.difficulty || null,
    topicTags: d.topics || [],
  });
}

/**
 * Backfill from recentAcSubmissionList. Catches solves made while no tab was
 * instrumented, and is the reason a change to LeetCode's submit endpoint
 * degrades the extension rather than breaking it.
 */
async function syncRecent() {
  await syncDayWindow().catch(() => {});
  const { meta } = await readAll();
  const base = hostForUser(meta);

  // Problem metadata is public, so this runs signed in or not — NeetCode-only
  // users never sign in to LeetCode, and their problems need it most.
  await enrichPending(base);

  const status = await fetchUserStatus(base);
  if (!status.isSignedIn || !status.username) {
    await patchMeta({ lastSyncAt: Date.now(), signedIn: false });
    return 0;
  }
  await patchMeta({ username: status.username, signedIn: true });

  const recent = await fetchRecentAccepted(base, status.username, 20);
  let imported = 0;

  for (const item of recent) {
    const at = Number(item.timestamp) * 1000;
    const res = await recordSubmission({
      id: `ac-${item.id}`,
      slug: item.titleSlug,
      title: item.title,
      at,
      verdict: 'Accepted',
      source: 'sync',
    });
    if (res.added) {
      imported += 1;
      if (res.firstSolve) await enrichFromGraphQL(item.titleSlug, base).catch(() => {});
    }
  }

  await patchMeta({ lastSyncAt: Date.now() });
  return imported;
}

/**
 * Backfill number/difficulty/tags for anything captured before we knew them —
 * live capture never sees any of the three, and problems solved before this
 * ran have none. Capped per run so a large history doesn't hammer the
 * endpoint; it converges over a few syncs.
 */
async function enrichPending(base) {
  const { problems } = await readAll();
  for (const slug of needsEnrichment(problems, 8)) {
    await enrichFromGraphQL(slug, base).catch(() => {});
  }
}

async function maybeRemind() {
  const settings = await getSettings();
  if (!settings.dailyReminder) return;

  const now = new Date();
  const hourHere = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: settings.timezone, hour: '2-digit', hour12: false }).format(now),
  );
  if (hourHere !== settings.reminderHour) return;

  const today = dayKey(now, settings.timezone, settings.dayStartHour);
  const { meta, days, reviews } = await readAll();
  if (meta.lastReminderOn === today) return; // once a day

  const solvedToday = (days[today]?.solved || 0) > 0;
  const due = dueBy(reviews, today).length;
  if (solvedToday && due === 0) return; // nothing to nag about

  const parts = [];
  if (!solvedToday) parts.push('nothing solved yet today');
  if (due) parts.push(`${due} review${due === 1 ? '' : 's'} due`);

  chrome.notifications.create(`leettrack:${today}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: 'LeetTrack',
    message: parts.join(' · '),
  });

  await patchMeta({ lastReminderOn: today });
}

chrome.notifications.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

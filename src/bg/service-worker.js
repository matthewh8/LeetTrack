// Coordinates capture, backfill, and reminders.

import {
  recordSubmission, enrichProblem, readAll, getSettings, patchMeta, reviewAction, syncDayWindow,
} from '../lib/storage.js';
import { HOSTS, fetchUserStatus, fetchRecentAccepted, fetchQuestion } from '../lib/leetcode-api.js';
import { dayKey } from '../lib/time.js';
import { dueBy } from '../lib/scheduler.js';
import { untaggedSlugs } from '../lib/patterns.js';

const SYNC_ALARM = 'leettrack:sync';
const REMINDER_ALARM = 'leettrack:reminder';

chrome.runtime.onInstalled.addListener(async () => {
  await patchMeta({ installedAt: Date.now() });
  // An upgrade lands here too: history recorded under the old midnight
  // boundary gets re-filed once, before anything reads it.
  await syncDayWindow().catch(() => {});
  await scheduleAlarms();
  syncRecent().catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  await syncDayWindow().catch(() => {});
  scheduleAlarms().catch(() => {});
});

async function scheduleAlarms() {
  await chrome.alarms.clear(SYNC_ALARM);
  await chrome.alarms.clear(REMINDER_ALARM);
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 30, delayInMinutes: 1 });
  chrome.alarms.create(REMINDER_ALARM, { periodInMinutes: 60, delayInMinutes: 5 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) syncRecent().catch(() => {});
  if (alarm.name === REMINDER_ALARM) maybeRemind().catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'leettrack:submission') {
        const result = await recordSubmission(msg.submission);
        if (result.added && result.firstSolve) {
          // Difficulty and tags aren't in the submit response; fetch them once.
          enrichFromGraphQL(msg.submission.slug).catch(() => {});
        }
        sendResponse({ ok: true, ...result });
        return;
      }
      if (msg?.type === 'leettrack:sync') {
        const n = await syncRecent();
        sendResponse({ ok: true, imported: n });
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
  const q = await fetchQuestion(base, slug);
  if (!q) return;
  await enrichProblem(slug, {
    title: q.title,
    frontendId: q.questionFrontendId,
    difficulty: q.difficulty,
    topicTags: (q.topicTags || []).map((t) => t.name),
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

  // Backfill tags/difficulty for anything captured before we knew them — live
  // capture never sees them, and problems solved before this ran have none.
  // Capped per sync so a large history doesn't hammer the endpoint.
  const { problems } = await readAll();
  for (const slug of untaggedSlugs(problems, 8)) {
    await enrichFromGraphQL(slug, base).catch(() => {});
  }

  await patchMeta({ lastSyncAt: Date.now() });
  return imported;
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

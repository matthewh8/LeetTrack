import {
  readAll, saveSettings, reviewAction, setNeedsReview, setRetired, syncDayWindow,
  exportAll, importAll, resetHistoryFrom, normaliseDayKey,
} from '../lib/storage.js';
import { todayKey, dayKey, addDays, diffDays, hourLabel } from '../lib/time.js';
import { computeStreak } from '../lib/streak.js';
import {
  dueBy, dueCountsByDay, flaggedReviews, retiredReviews, activeReviews,
  intervalAt, normaliseDelay, DELAY_PRESETS,
} from '../lib/scheduler.js';
import { difficultyCounts, recentSolves, DIFFICULTIES } from '../lib/stats.js';
import { patternsFor, patternCounts } from '../lib/patterns.js';
import { renderHeatmap } from './components/heatmap.js';
import { renderCalendar } from './components/calendar.js';
import { createTooltip } from './components/tooltip.js';

const $ = (sel) => document.querySelector(sel);
const tip = createTooltip();

const view = { month: null, selected: null, showAllQueue: false };
let state = null;

const problemUrl = (slug, host) => `https://${host || 'leetcode.com'}/problems/${slug}/`;

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

function relativeDay(key, today) {
  const d = diffDays(today, key);
  if (d === 0) return 'today';
  if (d === -1) return 'yesterday';
  if (d === 1) return 'tomorrow';
  return d < 0 ? `${-d} days ago` : `in ${d} days`;
}

async function load() {
  // Cheap no-op unless the window moved; the first run after an upgrade or a
  // settings change is the one that re-files history.
  await syncDayWindow().catch(() => {});
  state = await readAll();
  applyTheme(state.settings.theme);
  const today = todayKey(state.settings.timezone, state.settings.dayStartHour);
  if (!view.month) view.month = today.slice(0, 7);
  if (!view.selected) view.selected = today;
  render(today);
}

function render(today) {
  const { days, problems, reviews, settings, meta } = state;

  // ---- streak ----
  const streak = computeStreak(days, today);
  $('#streak-n').textContent = streak.current;
  $('#streak-unit').textContent = streak.current === 1 ? 'day' : 'days';
  $('#streak-longest').textContent = streak.longest;
  $('#streak-active').textContent = streak.activeDays;
  $('#streak-sub').textContent = !streak.current
    ? 'Solve one problem to start a streak.'
    : streak.solvedToday
      ? (streak.current >= streak.longest
          ? 'Personal best — keep it going.'
          : `${streak.toRecord} more day${streak.toRecord === 1 ? '' : 's'} to beat your record.`)
      : `Not solved yet today — the streak holds until ${hourLabel(settings.dayStartHour)}.`;

  // ---- difficulty ----
  const diff = difficultyCounts(problems);
  $('#solved-n').textContent = diff.total;
  const bar = $('#diffbar');
  bar.replaceChildren();
  if (diff.total) {
    for (const d of DIFFICULTIES) {
      if (!diff[d]) continue;
      const i = document.createElement('i');
      i.dataset.d = d;
      i.style.flex = String(diff[d]);
      i.setAttribute('aria-label', `${d}: ${diff[d]}`);
      bar.appendChild(i);
    }
    if (diff.Unknown) {
      const i = document.createElement('i');
      i.dataset.d = 'empty';
      i.style.flex = String(diff.Unknown);
      bar.appendChild(i);
    }
  } else {
    bar.innerHTML = '<i data-d="empty"></i>';
  }
  $('#difflegend').innerHTML = DIFFICULTIES
    .map((d) => `<li><i class="sw" data-d="${d}"></i>${d} <b>${diff[d]}</b></li>`)
    .join('');

  // ---- reviews ----
  const due = dueBy(reviews, today);
  const counts = dueCountsByDay(reviews);
  $('#due-n').textContent = due.length;
  const overdue = due.filter((r) => r.dueOn < today && !r.needsReview).length;
  const flagged = flaggedReviews(reviews).length;
  const notes = [];
  if (overdue) notes.push(`${overdue} overdue`);
  if (flagged) notes.push(`${flagged} marked needs review`);
  $('#due-sub').textContent = !Object.keys(reviews).length
    ? 'Reviews are scheduled automatically when you solve something.'
    : due.length
      ? (notes.length ? notes.join(' · ') : 'Scheduled for today')
      : 'Nothing due — next one is later.';

  const upcoming = activeReviews(reviews)
    .filter((r) => r.dueOn > today)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
  const scheduled = activeReviews(reviews).length;
  $('#rev-note').textContent = [
    scheduled ? `${scheduled} on the schedule` : '',
    upcoming ? `next ${relativeDay(upcoming.dueOn, today)}` : '',
  ].filter(Boolean).join(' · ');

  renderCalendar($('#calendar'), {
    monthKey: view.month,
    dueCounts: counts,
    today,
    selected: view.selected,
    tip,
    onSelect: (key) => { view.selected = key; render(today); },
    onMonth: (m) => { view.month = m; render(today); },
  });
  renderQueue(today, counts);
  renderRetired();

  // ---- heatmap ----
  const first = Object.keys(days).sort()[0];
  const weeks = first ? Math.min(52, Math.max(26, Math.ceil(diffDays(first, today) / 7) + 1)) : 26;
  renderHeatmap($('#heatmap'), { days, endKey: today, weeks, tip });
  const windowStart = addDays(today, -(weeks * 7 - 1));
  const solvedWindow = Object.entries(days)
    .filter(([k]) => k >= windowStart && k <= today)
    .reduce((s, [, v]) => s + (v.solved || 0), 0);
  $('#hm-note').textContent = `${solvedWindow} solved in the last ${weeks} weeks`;

  // ---- patterns ----
  renderPatterns(problems);

  // ---- recent ----
  const recent = recentSolves(problems, 8);
  $('#recent').innerHTML = recent.length
    ? recent.map((p) => `
        <div class="r-item" data-slug="${escapeHtml(p.slug)}">
          <div class="r-main">
            <a class="q-title" href="${problemUrl(p.slug, meta.host)}" target="_blank" rel="noreferrer">${escapeHtml(p.title)}</a>
            ${patternChips(p) ? `<span class="q-meta">${patternChips(p)}</span>` : ''}
          </div>
          ${p.difficulty ? `<span class="tag" data-d="${p.difficulty}">${p.difficulty}</span>` : ''}
          <span class="r-when">${relativeDay(dayOf(p.lastSolvedAt, state.settings.timezone), today)}</span>
          ${flagButton(reviews[p.slug])}
          ${recentMenu(reviews[p.slug], settings.intervals)}
        </div>`).join('')
    : '<p class="empty">Solve a problem on LeetCode and it will appear here.</p>';

  // ---- sync note ----
  $('#sync-note').textContent = meta.username
    ? `Signed in as ${meta.username}${meta.lastSyncAt ? ` · synced ${relativeDay(dayOf(meta.lastSyncAt, settings.timezone), today)}` : ''}`
    : 'Open LeetCode while signed in to start tracking.';
}

function dayOf(ms, tz) {
  return dayKey(new Date(ms), tz, state.settings.dayStartHour);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Chips for the one or two tags that actually say something about approach. */
function patternChips(problem) {
  return patternsFor(problem?.topicTags)
    .map((t) => `<span class="chip">${escapeHtml(t)}</span>`)
    .join('');
}

/**
 * Which techniques you've actually practised, most first. Counts can exceed the
 * problem total because a problem can surface two patterns — that's the point,
 * not double counting.
 */
function renderPatterns(problems) {
  const counts = patternCounts(problems);
  const el = $('#patterns');

  if (!counts.length) {
    $('#pat-note').textContent = '';
    el.innerHTML = '<p class="empty">Solve a few problems and the techniques behind them show up here. '
      + 'Tags are fetched from LeetCode on the next sync.</p>';
    return;
  }

  const shown = counts.slice(0, 9);
  const max = shown[0].count;
  const tagged = Object.values(problems).filter((p) => p.topicTags?.length).length;
  $('#pat-note').textContent = `${counts.length} across ${tagged} problem${tagged === 1 ? '' : 's'}`;

  el.innerHTML = shown.map((c) => `
    <div class="pat-row">
      <span class="pat-tag" title="${escapeHtml(c.tag)}">${escapeHtml(c.tag)}</span>
      <span class="pat-bar"><i style="width:${Math.max(4, (c.count / max) * 100)}%"></i></span>
      <span class="pat-n tabular">${c.count}</span>
    </div>`).join('')
    + (counts.length > shown.length
      ? `<p class="pat-more">+${counts.length - shown.length} more</p>` : '');
}

/**
 * A "needs review" toggle. Flagged problems jump the queue whatever their due
 * date says — the schedule is a guess, and this is you overriding it.
 */
function flagButton(review) {
  const on = !!review?.needsReview;
  const label = on ? 'Remove the needs-review mark' : 'Mark as needing review';
  return `<button class="btn btn-sm btn-flag" data-act="${on ? 'unflag' : 'flag'}"
    aria-pressed="${on}" aria-label="${label}" title="${label}">${on ? '\u2605' : '\u2606'}</button>`;
}

/**
 * The overflow menu on a queue row: everything that isn't Done or Again.
 * `compact` drops the scheduling half, for rows that aren't due — there is
 * nothing to push back, but you may well want the problem off the schedule.
 */
function moreMenu(review, intervals, { compact = false } = {}) {
  const cycle = intervalAt(intervals, review.stage);
  const schedule = `
    <p class="menu-h">Push it back</p>
    ${DELAY_PRESETS.map((o) =>
      `<button type="button" class="menu-item" data-act="delay" data-days="${o.days}">${o.label}</button>`).join('')}
    <div class="menu-row">
      <input class="q-days" type="number" min="1" max="3650" step="1" placeholder="days"
        aria-label="Delay by a number of days">
      <button type="button" class="btn btn-sm" data-act="delay" data-days="custom">Delay</button>
    </div>
    <hr class="menu-sep">
    <button type="button" class="menu-item" data-act="skip">
      Skip this cycle <span class="menu-hint">+${cycle}d, stage ${review.stage + 1} kept</span>
    </button>
    <hr class="menu-sep">`;

  return `
    <details class="menu">
      <summary class="btn btn-sm" aria-label="More actions">More</summary>
      <div class="menu-pop">
        ${compact ? '' : schedule}
        <button type="button" class="menu-item" data-act="retire">
          Remove from review
          <span class="menu-hint">Off the calendar. Stays in your solved history.</span>
        </button>
      </div>
    </details>`;
}

/**
 * The same menu on a recent solve, where the useful action is "stop asking me
 * about this one" — you have just seen it and know whether it needs revisiting.
 */
function recentMenu(review, intervals) {
  if (!review) return '';
  if (review.retired) {
    return `<button class="btn btn-sm" data-act="restore" title="Put this back on the review schedule">Restore</button>`;
  }
  return moreMenu(review, intervals, { compact: true });
}

const QUEUE_PREVIEW = 10;

function renderQueue(today, counts) {
  const { reviews, problems, settings, meta } = state;
  const showingToday = view.selected === today;
  const all = showingToday
    ? dueBy(reviews, today)
    : activeReviews(reviews).filter((r) => r.dueOn === view.selected);

  const heading = showingToday ? 'Due today' : `Scheduled for ${view.selected}`;

  const el = $('#queue');
  if (!all.length) {
    el.innerHTML = `<h3>${heading}</h3><p class="empty">${
      showingToday ? 'Nothing due. Enjoy the day off.' : 'Nothing scheduled for this day.'
    }</p>`;
    return;
  }

  // A long overdue pile would push the rest of the page out of reach, so only
  // the first screenful is drawn until asked otherwise.
  const list = view.showAllQueue ? all : all.slice(0, QUEUE_PREVIEW);

  el.innerHTML = `<h3>${heading} · ${all.length}</h3>` + list.map((r) => {
    const p = problems[r.slug] || { title: r.slug };
    const late = r.dueOn < today;
    const when = late
      ? `<span class="overdue">due ${relativeDay(r.dueOn, today)}</span>`
      : `<span>${r.dueOn === today ? `stage ${r.stage + 1}` : `due ${relativeDay(r.dueOn, today)}`}</span>`;
    return `
      <div class="q-item" data-slug="${escapeHtml(r.slug)}"${r.needsReview ? ' data-flagged="1"' : ''}>
        <div class="q-main">
          <a class="q-title" href="${problemUrl(r.slug, meta.host)}" target="_blank" rel="noreferrer">${escapeHtml(p.title)}</a>
          <span class="q-meta">${r.needsReview ? '<span class="flagged">Needs review</span>' : ''}${when}${patternChips(p)}</span>
        </div>
        ${p.difficulty ? `<span class="tag" data-d="${p.difficulty}">${p.difficulty}</span>` : ''}
        <div class="q-actions">
          <button class="btn btn-sm btn-primary" data-act="done">Done</button>
          <button class="btn btn-sm" data-act="again">Again</button>
          ${moreMenu(r, settings.intervals)}
          ${flagButton(r)}
        </div>
      </div>`;
  }).join('')
    + (all.length > list.length
      ? `<p class="q-more"><button class="linkish" id="btn-queue-all">Show all ${all.length}</button></p>`
      : '');

  const more = $('#btn-queue-all');
  if (more) more.addEventListener('click', () => { view.showAllQueue = true; render(today); });
}

/**
 * Problems taken off the schedule. Kept visible but out of the way: the point
 * of removing one is not to think about it, and the point of listing them is
 * that "removed" must never feel like "deleted".
 */
function renderRetired() {
  const { reviews, problems, meta } = state;
  const list = retiredReviews(reviews);
  const el = $('#retired');

  if (!list.length) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = `
    <details class="retired-box">
      <summary>Removed from review · ${list.length}</summary>
      ${list.map((r) => {
        const p = problems[r.slug] || { title: r.slug };
        return `
          <div class="retired-item" data-slug="${escapeHtml(r.slug)}">
            <a class="retired-title" href="${problemUrl(r.slug, meta.host)}" target="_blank" rel="noreferrer">${escapeHtml(p.title)}</a>
            <button class="btn btn-sm" data-act="restore">Restore</button>
          </div>`;
      }).join('')}
      <p class="retired-note">Still counted as solved — they just aren't scheduled.</p>
    </details>`;
}

/**
 * One handler for every per-problem button, in the queue and in recent solves
 * alike. `delay` is the only one that carries an argument: a preset number of
 * days, or whatever was typed into the box beside the Delay button.
 */
async function runAction(btn) {
  const host = btn.closest('[data-slug]');
  const slug = host?.dataset.slug;
  if (!slug) return;
  const action = btn.dataset.act;

  if (action === 'flag' || action === 'unflag') {
    btn.disabled = true;
    await setNeedsReview(slug, action === 'flag');
    tip.hide();
    await load();
    return;
  }

  if (action === 'retire' || action === 'restore') {
    btn.disabled = true;
    await setRetired(slug, action === 'retire');
    tip.hide();
    await load();
    return;
  }

  let opts = {};
  if (action === 'delay') {
    const input = host.querySelector('.q-days');
    const days = normaliseDelay(btn.dataset.days === 'custom' ? input?.value : btn.dataset.days);
    if (!days) {
      input?.focus();
      return;
    }
    opts = { days };
  }

  btn.disabled = true;
  await reviewAction(slug, action, opts);
  tip.hide();
  await load();
}

for (const sel of ['#queue', '#recent', '#retired']) {
  $(sel).addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) runAction(btn);
  });
}

// A delay menu left open would sit over the row beneath it after a re-render.
document.addEventListener('click', (e) => {
  for (const menu of document.querySelectorAll('.menu[open]')) {
    if (!menu.contains(e.target)) menu.open = false;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const menu of document.querySelectorAll('.menu[open]')) menu.open = false;
});

$('#btn-sync').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'leettrack:sync' });
    btn.textContent = res?.ok ? `+${res.imported}` : 'Failed';
  } catch {
    btn.textContent = 'Failed';
  }
  await load();
  setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1600);
});

$('#btn-theme').addEventListener('click', async () => {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(state.settings.theme) + 1) % order.length];
  state.settings = await saveSettings({ theme: next });
  applyTheme(next);
});

// ---- settings ----
const dlg = $('#settings');
$('#btn-settings').addEventListener('click', () => {
  const s = state.settings;
  $('#f-tz').value = s.timezone;
  $('#f-intervals').value = s.intervals.join(',');
  $('#f-track-from').value = s.trackFrom || '';
  $('#f-day-start').value = String(s.dayStartHour);
  $('#f-remind').checked = s.dailyReminder;
  $('#f-hour').value = String(s.reminderHour);
  $('#f-theme').value = s.theme;
  $('#settings-msg').textContent = '';
  dlg.showModal();
});

$('#f-hour').innerHTML = Array.from({ length: 24 }, (_, h) =>
  `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`).join('');
$('#f-day-start').innerHTML = Array.from({ length: 24 }, (_, h) =>
  `<option value="${h}">${hourLabel(h)}${h === 0 ? ' (midnight)' : ''}</option>`).join('');
try {
  const zones = Intl.supportedValuesOf?.('timeZone') || [];
  $('#tz-list').innerHTML = zones.map((z) => `<option value="${z}"></option>`).join('');
} catch { /* older Chrome: free-text entry still works */ }

$('#settings-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  const f = new FormData(e.target);

  const prevFrom = state.settings.trackFrom || null;
  let trackFrom = normaliseDayKey(f.get('trackFrom'));
  // Moving the start date forward deletes history, so ask once and let a
  // decline keep the old date rather than the rest of the form.
  const prunes = trackFrom && trackFrom !== prevFrom && hasDataBefore(trackFrom);
  if (prunes && !confirm(
    `Delete all LeetTrack history before ${trackFrom}?\n\n`
    + 'This cannot be undone — export first if you want a copy.')) {
    trackFrom = prevFrom;
  }

  state.settings = await saveSettings({
    timezone: String(f.get('timezone') || '').trim(),
    intervals: String(f.get('intervals') || ''),
    trackFrom,
    dailyReminder: f.get('dailyReminder') === 'on',
    reminderHour: Number(f.get('reminderHour')),
    dayStartHour: Number(f.get('dayStartHour')),
    theme: String(f.get('theme')),
  });

  // Re-file before pruning: `resetHistoryFrom` compares day keys, and they have
  // to mean the same thing on both sides of the cutoff.
  await syncDayWindow().catch(() => {});
  if (trackFrom && trackFrom !== prevFrom) await resetHistoryFrom(trackFrom);
  await load();
});

function hasDataBefore(key) {
  return Object.keys(state.days).some((k) => k < key)
    || state.attempts.some((a) => a.day < key);
}

// ---- export / import ----
$('#btn-export').addEventListener('click', async () => {
  const payload = await exportAll();
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `leettrack-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$('#btn-import').addEventListener('click', () => $('#file-import').click());
$('#file-import').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    await importAll(JSON.parse(await file.text()));
    await load();
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
  e.target.value = '';
});

load().catch((err) => {
  document.querySelector('#main').insertAdjacentHTML('afterbegin',
    `<p class="empty">Could not load data: ${escapeHtml(err.message)}</p>`);
});

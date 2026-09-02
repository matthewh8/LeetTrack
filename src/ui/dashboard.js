import { readAll, saveSettings, reviewAction, exportAll, importAll } from '../lib/storage.js';
import { todayKey, addDays, diffDays } from '../lib/time.js';
import { computeStreak } from '../lib/streak.js';
import { dueBy, dueCountsByDay } from '../lib/scheduler.js';
import { difficultyCounts, qualityStats, mostRetried, recentSolves, DIFFICULTIES } from '../lib/stats.js';
import { renderHeatmap } from './components/heatmap.js';
import { renderCalendar } from './components/calendar.js';
import { renderVerdictChart } from './components/verdict-chart.js';
import { createTooltip } from './components/tooltip.js';

const $ = (sel) => document.querySelector(sel);
const tip = createTooltip();

const view = { month: null, selected: null };
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
  state = await readAll();
  applyTheme(state.settings.theme);
  const today = todayKey(state.settings.timezone);
  if (!view.month) view.month = today.slice(0, 7);
  if (!view.selected) view.selected = today;
  render(today);
}

function render(today) {
  const { days, problems, reviews, attempts, settings, meta } = state;

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
      : 'Not solved yet today — the streak holds until midnight.';

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
  const overdue = due.filter((r) => r.dueOn < today).length;
  $('#due-sub').textContent = !Object.keys(reviews).length
    ? 'Reviews are scheduled automatically when you solve something.'
    : due.length
      ? (overdue ? `${overdue} overdue` : 'Scheduled for today')
      : 'Nothing due — next one is later.';
  const reviewBtn = $('#btn-review');
  reviewBtn.hidden = due.length === 0;

  const upcoming = Object.values(reviews).filter((r) => r.dueOn > today).sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
  $('#rev-note').textContent = upcoming ? `Next: ${relativeDay(upcoming.dueOn, today)}` : '';

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

  // ---- heatmap ----
  const first = Object.keys(days).sort()[0];
  const weeks = first ? Math.min(52, Math.max(26, Math.ceil(diffDays(first, today) / 7) + 1)) : 26;
  renderHeatmap($('#heatmap'), { days, endKey: today, weeks, tip });
  const windowStart = addDays(today, -(weeks * 7 - 1));
  const solvedWindow = Object.entries(days)
    .filter(([k]) => k >= windowStart && k <= today)
    .reduce((s, [, v]) => s + (v.solved || 0), 0);
  $('#hm-note').textContent = `${solvedWindow} solved in the last ${weeks} weeks`;

  // ---- quality ----
  const q = qualityStats(days, today, 14);
  $('#acc-rate').textContent = q.attempts ? `${Math.round(q.acceptanceRate * 100)}%` : '—';
  $('#qstats').innerHTML = `
    <div><dt>Attempts</dt><dd>${q.attempts}</dd></div>
    <div><dt>Accepted</dt><dd>${q.accepted}</dd></div>
    <div><dt>Per accept</dt><dd>${q.accepted ? q.attemptsPerAc.toFixed(1) : '—'}</dd></div>`;
  renderVerdictChart($('#verdict'), { series: q.series, tip });

  const retried = mostRetried(attempts, addDays(today, -13), (a) => a.day);
  const bits = [];
  if (q.bestDay) bits.push(`Best day ${q.bestDay.key.slice(5)} — ${q.bestDay.accepted} accepted in ${q.bestDay.attempts}.`);
  if (retried) bits.push(`Most retries: ${problems[retried.slug]?.title || retried.slug} (${retried.wrong} wrong).`);
  else if (q.attempts) bits.push('No wrong answers in this window.');
  $('#q-foot').textContent = bits.join(' ') || 'No submissions captured yet.';

  // ---- recent ----
  const recent = recentSolves(problems, 8);
  $('#recent').innerHTML = recent.length
    ? recent.map((p) => `
        <div class="r-item">
          <div class="r-main">
            <a class="q-title" href="${problemUrl(p.slug, meta.host)}" target="_blank" rel="noreferrer">${escapeHtml(p.title)}</a>
          </div>
          ${p.difficulty ? `<span class="tag" data-d="${p.difficulty}">${p.difficulty}</span>` : ''}
          <span class="r-when">${relativeDay(dayOf(p.lastSolvedAt, state.settings.timezone), today)}</span>
        </div>`).join('')
    : '<p class="empty">Solve a problem on LeetCode and it will appear here.</p>';

  // ---- sync note ----
  $('#sync-note').textContent = meta.username
    ? `Signed in as ${meta.username}${meta.lastSyncAt ? ` · synced ${relativeDay(dayOf(meta.lastSyncAt, settings.timezone), today)}` : ''}`
    : 'Open LeetCode while signed in to start tracking.';
}

function dayOf(ms, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ms));
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderQueue(today, counts) {
  const { reviews, problems, meta } = state;
  const showingToday = view.selected === today;
  const list = showingToday
    ? dueBy(reviews, today)
    : Object.values(reviews).filter((r) => r.dueOn === view.selected);

  const heading = showingToday
    ? `Due today${counts[today] ? '' : ''}`
    : `Scheduled for ${view.selected}`;

  const el = $('#queue');
  if (!list.length) {
    el.innerHTML = `<h3>${heading}</h3><p class="empty">${
      showingToday ? 'Nothing due. Enjoy the day off.' : 'Nothing scheduled for this day.'
    }</p>`;
    return;
  }

  el.innerHTML = `<h3>${heading} · ${list.length}</h3>` + list.map((r) => {
    const p = problems[r.slug] || { title: r.slug };
    const late = r.dueOn < today;
    return `
      <div class="q-item" data-slug="${escapeHtml(r.slug)}">
        <div class="q-main">
          <a class="q-title" href="${problemUrl(r.slug, meta.host)}" target="_blank" rel="noreferrer">${escapeHtml(p.title)}</a>
          <span class="q-meta">${late ? `<span class="overdue">due ${relativeDay(r.dueOn, today)}</span>` : `stage ${r.stage + 1}`}</span>
        </div>
        ${p.difficulty ? `<span class="tag" data-d="${p.difficulty}">${p.difficulty}</span>` : ''}
        <div class="q-actions">
          <button class="btn btn-sm btn-primary" data-act="done">Done</button>
          <button class="btn btn-sm" data-act="again">Again</button>
          <button class="btn btn-sm" data-act="snooze">Snooze</button>
        </div>
      </div>`;
  }).join('');
}

$('#queue').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const slug = btn.closest('[data-slug]')?.dataset.slug;
  if (!slug) return;
  btn.disabled = true;
  await reviewAction(slug, btn.dataset.act);
  tip.hide();
  await load();
});

$('#btn-review').addEventListener('click', () => {
  $('#queue').scrollIntoView({ behavior: 'smooth', block: 'center' });
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
  $('#f-remind').checked = s.dailyReminder;
  $('#f-hour').value = String(s.reminderHour);
  $('#f-theme').value = s.theme;
  $('#settings-msg').textContent = '';
  dlg.showModal();
});

$('#f-hour').innerHTML = Array.from({ length: 24 }, (_, h) =>
  `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`).join('');
try {
  const zones = Intl.supportedValuesOf?.('timeZone') || [];
  $('#tz-list').innerHTML = zones.map((z) => `<option value="${z}"></option>`).join('');
} catch { /* older Chrome: free-text entry still works */ }

$('#settings-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  const f = new FormData(e.target);
  state.settings = await saveSettings({
    timezone: String(f.get('timezone') || '').trim(),
    intervals: String(f.get('intervals') || ''),
    dailyReminder: f.get('dailyReminder') === 'on',
    reminderHour: Number(f.get('reminderHour')),
    theme: String(f.get('theme')),
  });
  await load();
});

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

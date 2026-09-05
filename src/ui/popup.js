// Compact "what do I do right now" view: the streak, and today's review queue
// with one-tap Done — the two things worth a toolbar click.

import { readAll, reviewAction, syncDayWindow } from '../lib/storage.js';
import { todayKey } from '../lib/time.js';
import { computeStreak } from '../lib/streak.js';
import { dueBy } from '../lib/scheduler.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function render() {
  await syncDayWindow().catch(() => {});
  const { days, reviews, problems, settings, meta } = await readAll();
  if (settings.theme === 'light' || settings.theme === 'dark') {
    document.documentElement.dataset.theme = settings.theme;
  }

  const today = todayKey(settings.timezone, settings.dayStartHour);
  const streak = computeStreak(days, today);
  $('#p-streak').textContent = streak.current;
  $('#p-sub').textContent = streak.solvedToday
    ? 'Solved today. Nice.'
    : streak.current
      ? 'Not solved yet today.'
      : 'No streak yet — solve one to start.';

  const due = dueBy(reviews, today);
  $('#p-queue').innerHTML = due.length
    ? `<h3>Due now · ${due.length}</h3>` + due.slice(0, 6).map((r) => {
        const p = problems[r.slug] || { title: r.slug };
        return `<div class="p-item" data-slug="${esc(r.slug)}">
          ${r.needsReview ? '<span class="p-flag" title="Marked as needing review">\u2605</span>' : ''}
          <a class="p-title" href="https://${meta.host || 'leetcode.com'}/problems/${esc(r.slug)}/" target="_blank" rel="noreferrer">${esc(p.title)}</a>
          <button class="btn btn-sm" data-act="delay" title="Push this to tomorrow">+1d</button>
          <button class="btn btn-sm btn-primary" data-act="done">Done</button>
        </div>`;
      }).join('')
    : '<h3>Due now</h3><p class="p-empty">Nothing due. Enjoy the day off.</p>';
}

$('#p-queue').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  btn.disabled = true;
  const slug = btn.closest('[data-slug]').dataset.slug;
  await reviewAction(slug, btn.dataset.act, btn.dataset.act === 'delay' ? { days: 1 } : {});
  await render();
});

$('#p-open').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

render();

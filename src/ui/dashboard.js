import {
  readAll, saveSettings, reviewAction, setNeedsReview, setRetired, syncDayWindow,
  setTagHidden, restoreTags, setReviewFlag, exportAll, importAll, resetHistoryFrom, normaliseDayKey,
  recordSubmission, enrichProblem,
} from '../lib/storage.js';
import { todayKey, dayKey, addDays, diffDays, hourLabel } from '../lib/time.js';
import { computeStreak } from '../lib/streak.js';
import {
  dueBy, dueCountsByDay, flaggedReviews, retiredReviews, activeReviews,
  intervalAt,
} from '../lib/scheduler.js';
import { difficultyCounts, recentSolves, DIFFICULTIES } from '../lib/stats.js';
import {
  problemRows, searchProblems, STATUS_FILTERS, SORTS,
} from '../lib/search.js';
import {
  patternsOf, patternCounts, tagCounts, visibleTags, hiddenTags, hasTag,
} from '../lib/patterns.js';
import { renderHeatmap } from './components/heatmap.js';
import { renderCalendar, DRAG_TYPE } from './components/calendar.js';
import { createTooltip } from './components/tooltip.js';
import { problemUrl } from '../lib/links.js';

const $ = (sel) => document.querySelector(sel);
const tip = createTooltip();

const view = {
  tab: sessionStorage.getItem('leettrack:tab') || 'queue',
  month: null, selected: null, showAllQueue: false, openMenu: null,
  group: 'all', difficulty: 'all',
  q: '', status: 'all', sort: 'recent', dbLimit: 0,
};

const DB_PAGE = 25;
let state = null;

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (state?.settings.theme === 'system' || !state
  ? darkQuery.matches : state.settings.theme === 'dark');

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  // Sun in the dark, moon in the light: the icon is where a click takes you.
  const dark = theme === 'system' ? darkQuery.matches : theme === 'dark';
  const btn = document.querySelector('#btn-theme');
  btn.dataset.mode = dark ? 'dark' : 'light';
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}
darkQuery.addEventListener('change', () => { if (state) applyTheme(state.settings.theme); });

function switchTab(tab) {
  view.tab = tab;
  sessionStorage.setItem('leettrack:tab', tab);
  for (const btn of document.querySelectorAll('.tab-btn')) {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  }
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.classList.toggle('active', panel.dataset.tab === tab);
  }
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
  switchTab(view.tab);
  render(today);
}

function render(today) {
  const { days, problems, reviews, settings, meta } = state;

  // ---- streak ----
  // A flame by Sync now: lit once today's problem is in, grey until then —
  // the streak is still alive, it just hasn't been kept today.
  const streak = computeStreak(days, today);
  $('#streak-n').textContent = streak.current;
  $('#streak').dataset.lit = streak.solvedToday ? '1' : '0';
  $('#streak').setAttribute('aria-label', `${streak.current}-day streak, ${
    streak.solvedToday ? 'solved today' : 'not solved yet today'}`);
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
  renderFilters();
  const shown = reviews;
  const due = dueBy(shown, today);
  const counts = dueCountsByDay(shown);
  renderCounts(today, due.length);
  const overdue = due.filter((r) => r.dueOn < today && !r.needsReview).length;
  const flagged = flaggedReviews(shown).length;
  const notes = [];
  if (overdue) notes.push(`${overdue} overdue`);
  if (flagged) notes.push(`${flagged} marked needs review`);
  $('#due-sub').textContent = !Object.keys(reviews).length
    ? 'Reviews are scheduled automatically when you solve something.'
    : (due.length && view.selected === today ? notes.join(' · ') : '');

  drawCalendar(today, counts);
  renderQueue(today);
  renderRetired(today);

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
            <a class="q-title" href="${problemUrl(p.slug, meta.host, p)}" target="_blank" rel="noreferrer">${titleLine(p, p.slug)}</a>
            ${patternChips(p) ? `<span class="q-meta">${patternChips(p)}</span>` : ''}
          </div>
          ${p.difficulty ? `<span class="tag" data-d="${p.difficulty}">${p.difficulty}</span>` : ''}
          <span class="r-when">${relativeDay(dayOf(p.lastSolvedAt, state.settings.timezone), today)}</span>
          ${flagButton(reviews[p.slug])}
          ${recentMenu(p.slug, reviews[p.slug])}
        </div>`).join('')
    : '<p class="empty">Solve a problem on LeetCode or NeetCode and it will appear here.</p>';

  // ---- all problems ----
  renderProblems(today);

  // A row menu left open across a re-render: only tag edits ask for this, and
  // only for the row that was being edited. The list is part of the address —
  // a problem due today is also a recent solve, so the slug alone would be
  // ambiguous and could reopen the other one.
  if (view.openMenu) {
    const { slug, list } = view.openMenu;
    const again = document.querySelector(`#${list} [data-slug="${CSS.escape(slug)}"] .menu`);
    if (again) again.open = true;
    else view.openMenu = null;
  }

  // ---- sync note ----
  const syncNote = $('#sync-note');
  if (!meta.username) {
    syncNote.textContent = 'Open LeetCode or NeetCode while signed in to start tracking.';
    syncNote.className = '';
  } else {
    const parts = [`Signed in as ${meta.username}`];
    if (meta.lastSyncAt) parts.push(`synced ${relativeDay(dayOf(meta.lastSyncAt, settings.timezone), today)}`);
    syncNote.textContent = parts.join(' · ');
    syncNote.className = '';
    if (meta.lastSyncError) {
      syncNote.textContent += ` · Last sync failed: ${meta.lastSyncError}`;
      syncNote.classList.add('sync-warn');
    } else if (meta.lastSyncAt && Date.now() - meta.lastSyncAt > 90 * 60_000) {
      syncNote.textContent += ' · Sync may be stalled — try reloading the extension';
      syncNote.classList.add('sync-warn');
    }
  }
  if (meta.deviceSyncError) {
    syncNote.textContent += ` · Device sync failed: ${meta.deviceSyncError}`;
    syncNote.classList.add('sync-warn');
  } else if (meta.deviceSyncAt) {
    syncNote.textContent += ` · devices synced ${relativeDay(dayOf(meta.deviceSyncAt, settings.timezone), today)}`;
  }
}

/**
 * The month grid. Paging months redraws only the calendar: the queue doesn't
 * depend on the month, and a drag in progress started on a queue row — if that
 * row were rebuilt under the pointer, the browser would drop the drag.
 */
function drawCalendar(today, counts = dueCountsByDay(state.reviews)) {
  renderCalendar($('#calendar'), {
    monthKey: view.month,
    dueCounts: counts,
    today,
    selected: view.selected,
    tip,
    onSelect: (key) => { view.selected = key; render(today); },
    onMonth: (m) => { view.month = m; drawCalendar(today); },
    onDrop: (key, slug) => moveTo(slug, key),
  });
}

/**
 * Drag a review onto another day. A move is not a review: only the date
 * changes, so the interval ladder picks up exactly where it was.
 */
async function moveTo(slug, key) {
  const review = state.reviews[slug];
  if (!review || review.dueOn === key) return;
  await reviewAction(slug, 'move', { to: key });
  tip.hide();
  await load();
  const p = state.problems[slug];
  flash(`Moved ${p?.title || slug} to ${key}. Its review cycle is unchanged.`);
}

let flashTimer = null;
function flash(text) {
  const el = $('#q-flash');
  el.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.textContent = ''; }, 4000);
}

function dayOf(ms, tz) {
  return dayKey(new Date(ms), tz, state.settings.dayStartHour);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * "1. Two Sum" — the LeetCode number in front of the title, the way everyone
 * refers to these problems out loud. Numbers arrive from GraphQL, so a problem
 * captured live shows without one until the next sync fills it in.
 */
function titleLine(problem, slug) {
  const n = problem?.frontendId;
  // The space is real, not just margin: this text gets read aloud and copied.
  return (n ? `<span class="q-num tabular">${escapeHtml(n)}.</span> ` : '')
    + escapeHtml(problem?.title || slug);
}

/** Chips for the one or two tags that actually say something about approach. */
function patternChips(problem) {
  return patternsOf(problem)
    .map((t) => `<span class="chip">${escapeHtml(t)}</span>`)
    .join('');
}

// ---- problem filters ----

/**
 * The group, difficulty, status and sort selects above the problem index.
 *
 * Options come from every tracked problem, not just the scheduled ones: the
 * index lists retired and unscheduled problems too.
 *
 * Matching is on the problem's whole tag list, not on the one or two chips it
 * shows, so filtering by "Linked List" finds the linked-list problem whose chip
 * says "Recursion".
 */
function renderFilters() {
  const { problems } = state;

  const groups = tagCounts(problems);
  // A filter set from a tag that has since been removed must stay selectable,
  // or the select would silently snap back to "All groups" and show more rows
  // than asked for.
  if (view.group !== 'all' && !groups.some((g) => g.tag === view.group)) {
    groups.unshift({ tag: view.group, count: 0 });
  }
  const groupHtml = `<option value="all">All groups</option>`
    + groups.map((g) => `<option value="${escapeHtml(g.tag)}">${escapeHtml(g.tag)} (${g.count})</option>`).join('');
  for (const sel of [$('#db-group')]) {
    sel.innerHTML = groupHtml;
    sel.value = view.group;
  }

  const present = [...DIFFICULTIES, 'Unknown']
    .map((d) => ({ d, n: Object.values(problems).filter((p) => (p.difficulty || 'Unknown') === d).length }))
    .filter(({ d, n }) => n || d === view.difficulty);
  const diffHtml = `<option value="all">Any difficulty</option>`
    + present.map(({ d, n }) => `<option value="${d}">${d} (${n})</option>`).join('');
  for (const sel of [$('#db-diff')]) {
    sel.innerHTML = diffHtml;
    sel.value = view.difficulty;
  }

  const statusSel = $('#db-status');
  statusSel.innerHTML = STATUS_FILTERS
    .map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
  statusSel.value = view.status;

  const sortSel = $('#db-sort');
  sortSel.innerHTML = SORTS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
  sortSel.value = view.sort;

}

function setFilter(patch) {
  Object.assign(view, patch);
  // A filter that hides the open "show everything" list would leave the button
  // gone and the list truncated at the same time; start it fresh instead.
  view.showAllQueue = false;
  render(todayKey(state.settings.timezone, state.settings.dayStartHour));
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

  // Each row filters the review card by that pattern — the question a
  // breakdown provokes is "show me those", and the answer is one click away.
  el.innerHTML = shown.map((c) => `
    <button type="button" class="pat-row" data-group="${escapeHtml(c.tag)}"
      aria-pressed="${view.group === c.tag}"
      title="Show only ${escapeHtml(c.tag)} problems">
      <span class="pat-tag">${escapeHtml(c.tag)}</span>
      <span class="pat-bar"><i style="width:${Math.max(4, (c.count / max) * 100)}%"></i></span>
      <span class="pat-n tabular">${c.count}</span>
    </button>`).join('')
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
 * The overflow menu on a row: Again, tags, needs-review and Retire. Dates
 * aren't here — dragging a row onto the calendar is how a review moves.
 */
function moreMenu(slug, review, { includeAgain = false, includeFlag = false } = {}) {
  const againItem = (includeAgain && review) ? `
    <button type="button" class="menu-item" data-act="again">
      Again <span class="menu-hint">Back tomorrow</span>
    </button>
    <hr class="menu-sep">` : '';
  const flagItem = (includeFlag && review) ? `
    <button type="button" class="menu-item" data-act="${review.needsReview ? 'unflag' : 'flag'}">
      ${review.needsReview ? '★ Remove needs-review mark' : '☆ Mark as needs review'}
    </button>` : '';

  return `
    <details class="menu">
      <summary class="btn btn-sm" aria-label="More actions">More</summary>
      <div class="menu-pop">
        ${againItem}
        ${tagEditor(slug)}
        ${flagItem}
        ${review ? `
        <button type="button" class="menu-item" data-act="retire">
          Retire
          <span class="menu-hint">Off the calendar, into the Retired tab. Still counted as solved.</span>
        </button>` : ''}
      </div>
    </details>`;
}

/**
 * The same menu on a recent solve, where the useful action is "stop asking me
 * about this one" — you have just seen it and know whether it needs revisiting.
 */
function recentMenu(slug, review) {
  if (review?.retired) {
    return `<button class="btn btn-sm" data-act="restore" title="Put this back on the review schedule">Restore</button>`;
  }
  return moreMenu(slug, review);
}

/**
 * Tags, with an × on each.
 *
 * LeetCode's tags are not gospel — some are plainly wrong for the problem, and
 * a wrong one distorts the patterns breakdown and the group filter until it is
 * gone. Removing is a per-problem overlay, never a delete: the removed ones
 * are listed underneath and go back with one click.
 */
function tagEditor(slug) {
  const problem = state.problems[slug];
  if (!problem) return '';
  const shown = visibleTags(problem);
  const removed = hiddenTags(problem);
  if (!shown.length && !removed.length) return '';

  return `
    <p class="menu-h">Tags</p>
    <div class="tag-edit">
      ${shown.map((t) => `
        <button type="button" class="chip chip-x" data-act="untag" data-tag="${escapeHtml(t)}"
          title="Remove the ${escapeHtml(t)} tag from this problem">
          ${escapeHtml(t)}<span class="x" aria-hidden="true">\u00d7</span>
        </button>`).join('')
      || '<p class="menu-hint">All tags removed.</p>'}
    </div>
    ${removed.length ? `
      <button type="button" class="menu-item" data-act="retag">
        Restore ${removed.length} removed tag${removed.length === 1 ? '' : 's'}
        <span class="menu-hint">${escapeHtml(removed.join(', '))}</span>
      </button>` : ''}
    <hr class="menu-sep">`;
}

const STATUS_LABEL = {
  due: 'Due now',
  upcoming: 'Scheduled',
  'needs-review': 'Needs review',
  removed: 'Removed',
  unscheduled: 'Not scheduled',
};

/**
 * The problem index: every problem you have tracked, in one list you can
 * search. The group and difficulty come from the shared filter, so setting a
 * group on the Reviews card — or clicking a row in Patterns — narrows this too.
 */
function renderProblems(today) {
  const { problems, reviews, settings, meta } = state;

  const rows = problemRows(problems, reviews, today);
  const found = searchProblems(rows, {
    query: view.q,
    group: view.group,
    difficulty: view.difficulty,
    status: view.status,
    sort: view.sort,
  });

  const narrowed = found.length !== rows.length;
  $('#db-note').textContent = !rows.length
    ? ''
    : narrowed
      ? `${found.length} of ${rows.length}`
      : `${rows.length} problem${rows.length === 1 ? '' : 's'}`;

  const el = $('#problems');
  if (!rows.length) {
    el.innerHTML = '<p class="empty">Nothing tracked yet. Solve a problem on LeetCode or NeetCode '
      + 'and it will show up here.</p>';
    return;
  }
  if (!found.length) {
    el.innerHTML = '<p class="empty">No problem matches that. '
      + '<button class="linkish" data-db="reset">Clear the search and filters</button></p>';
    return;
  }

  const limit = view.dbLimit || DB_PAGE;
  const shown = found.slice(0, limit);

  el.innerHTML = shown.map((r) => {
    const p = problems[r.slug];
    const when = r.dueOn
      ? `<span class="${r.due ? 'overdue' : ''}">${r.due ? 'due ' : ''}${relativeDay(r.dueOn, today)}</span>`
      : '';
    return `
      <div class="db-item" data-slug="${escapeHtml(r.slug)}"${r.retired ? ' data-off="1"' : ''}>
        <div class="db-main">
          <a class="q-title" href="${problemUrl(r.slug, meta.host, p)}" target="_blank" rel="noreferrer">${titleLine(p, r.slug)}</a>
          <span class="q-meta">
            <span class="db-status" data-s="${r.status}">${STATUS_LABEL[r.status]}</span>
            ${when}
            ${r.solveCount > 1 ? `<span>solved ${r.solveCount}\u00d7</span>` : ''}
            ${patternChips(p)}
          </span>
        </div>
        ${r.difficulty !== 'Unknown' ? `<span class="tag" data-d="${r.difficulty}">${r.difficulty}</span>` : ''}
        <span class="db-when">${r.lastSolvedAt ? relativeDay(dayOf(r.lastSolvedAt, settings.timezone), today) : ''}</span>
        ${flagButton(r.review)}
        ${recentMenu(r.slug, r.review)}
      </div>`;
  }).join('')
    + (found.length > shown.length
      ? `<p class="q-more"><button class="linkish" data-db="more">Show ${
          Math.min(DB_PAGE, found.length - shown.length)} more of ${found.length}</button></p>`
      : '');
}

const QUEUE_PREVIEW = 10;

/** "Wed, Oct 14" for a day key. */
function longDate(key) {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

/**
 * Two counts, never one number doing two jobs. "Due today" is always shown
 * and includes overdue and needs-review problems; the selected day appears
 * beside it only when you pick another date, and counts just what is
 * scheduled on that date. The one the list below belongs to is outlined, in
 * the same accent as the selected calendar day.
 */
function renderCounts(today, dueToday) {
  const sel = view.selected;
  const onOther = sel !== today;
  const selCount = onOther ? activeReviews(state.reviews).filter((r) => r.dueOn === sel).length : 0;
  const box = (key, n, label, sub, active) => `
    <button type="button" class="rev-count" data-day="${key}" aria-pressed="${active}">
      <span class="figure tabular">${n}</span>
      <span class="rev-count-txt">
        <span class="rev-count-label">${label}</span>
        <span class="rev-count-sub">${sub}</span>
      </span>
    </button>`;
  $('#rev-counts').innerHTML =
    box(today, dueToday, 'due today', longDate(today), !onOther)
    + (onOther
      ? box(sel, selCount, `scheduled ${relativeDay(sel, today)}`, longDate(sel), true)
      : '');
}

// Today's list never runs short: when fewer than this many are due, the
// next ones on the schedule fill it up, so there is always something to do.
const QUEUE_MIN = 5;

function renderQueue(today) {
  const { reviews } = state;
  const showingToday = view.selected === today;
  const all = showingToday
    ? dueBy(reviews, today)
    : activeReviews(reviews).filter((r) => r.dueOn === view.selected);

  // Top-up from the days ahead, soonest first. Same buttons as a due row —
  // reviewing early is still a review, scheduled on from today.
  const ahead = showingToday && all.length < QUEUE_MIN
    ? activeReviews(reviews)
      .filter((r) => r.dueOn > today && !r.needsReview)
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.slug.localeCompare(b.slug))
      .slice(0, QUEUE_MIN - all.length)
    : [];

  const el = $('#queue');
  if (!all.length && !ahead.length) {
    el.innerHTML = `<p class="empty">${showingToday
      ? 'Nothing due, and nothing scheduled. Solve something new and it will show up here.'
      : 'Nothing scheduled for this day.'}</p>`;
    return;
  }

  const list = view.showAllQueue ? all : all.slice(0, QUEUE_PREVIEW);

  // The upcoming rows sit under a divider and their own day headings, so a
  // problem pulled in early never reads as one that was due.
  let lastDay = null;
  const aheadRows = ahead.map((r) => {
    const head = r.dueOn === lastDay ? '' : `
      <tr class="q-group"><td colspan="3">
        <span class="q-group-when">${relativeDay(r.dueOn, today).replace(/^\w/, (c) => c.toUpperCase())}</span>
        <span class="q-group-date">${longDate(r.dueOn)}</span>
      </td></tr>`;
    lastDay = r.dueOn;
    return head + queueRow(r, today, { early: true });
  }).join('');

  // No heading: the highlighted count box above already names the day.
  el.innerHTML = (showingToday && !all.length
    ? '<p class="q-clear"><span aria-hidden="true">✓</span> All caught up for today. Here\'s what\'s next if you want to get ahead.</p>'
    : '')
    + `<div class="q-table-wrap">
    <table class="q-table">
      <colgroup><col class="q-col-flags"><col class="q-col-problem"><col class="q-col-actions"></colgroup>
      <tbody>${list.map((r) => queueRow(r, today)).join('')}${
        ahead.length ? `<tr class="q-divider"><td colspan="3">Up next</td></tr>${aheadRows}` : ''}</tbody>
    </table></div>`
    + (all.length > list.length
      ? `<p class="q-more"><button class="linkish" id="btn-queue-all">Show all ${all.length}</button></p>`
      : '');

  const more = $('#btn-queue-all');
  if (more) more.addEventListener('click', () => { view.showAllQueue = true; render(today); });
}

/** One queue row. `early` marks a top-up row that isn't due yet. */
function queueRow(r, today, { early = false } = {}) {
  const { problems, settings, meta } = state;
  const p = problems[r.slug] || { title: r.slug };
  const late = r.dueOn < today;
  const nextUp = intervalAt(settings.intervals, r.stage + 1);
  const afterAce = intervalAt(settings.intervals, r.stage + 3);
  const lastReviewed = r.lastReviewedAt || null;
  return `
    <tr data-slug="${escapeHtml(r.slug)}"${r.needsReview ? ' data-flagged="1"' : ''}${early ? ' data-early="1"' : ''} draggable="true">
      <td class="q-col-flags">
        <div class="q-flags">
          <span class="q-grip" aria-hidden="true" title="Drag onto a calendar day to move it">⠇</span>
          <button class="q-flag" data-flag="important" aria-pressed="${!!r.important}"
                  title="Must-do — keeps this at the top of the queue">★</button>
          <button class="q-flag" data-flag="struggling" aria-pressed="${!!r.struggling}"
                  title="Struggling with this one">⚑</button>
        </div>
      </td>
      <td class="q-col-problem">
        <a class="q-title" href="${problemUrl(r.slug, meta.host, p)}" target="_blank" rel="noreferrer">${titleLine(p, r.slug)}</a>
        <span class="q-meta">${r.needsReview ? '<span class="flagged">Needs review</span>' : ''}${
          p.difficulty ? `<span class="tag" data-d="${p.difficulty}">${p.difficulty}</span>` : ''}${
          patternChips(p)}${
          late ? `<span class="q-late">${diffDays(r.dueOn, today)}d late</span>` : ''}${
          lastReviewed ? `<span class="q-last">reviewed ${relativeDay(lastReviewed, today)}</span>` : ''}</span>
      </td>
      <td class="q-col-actions">
        <div class="q-actions">
          <button class="btn btn-sm btn-primary" data-act="done"
            title="Reviewed — next rung of the ladder, back in ${nextUp} days">Done</button>
          <button class="btn btn-sm btn-ace" data-act="ace"
            title="Nailed it — skips a cycle. Still back in ${nextUp} days, but two rungs up, so the review after that is ${afterAce} days out.">Nailed it</button>
          ${moreMenu(r.slug, r, { includeAgain: true, includeFlag: true })}
        </div>
      </td>
    </tr>`;
}

/**
 * Problems taken off the schedule, on their own tab. The point of retiring
 * one is not to think about it, and the point of listing them is that
 * "retired" must never feel like "deleted".
 */
function renderRetired(today) {
  const { reviews, problems, settings, meta } = state;
  const list = retiredReviews(reviews);
  const el = $('#retired');

  $('#tab-retired-n').textContent = list.length ? String(list.length) : '';
  $('#ret-note').textContent = list.length
    ? `${list.length} problem${list.length === 1 ? '' : 's'}` : '';

  if (!list.length) {
    el.innerHTML = '<p class="empty">Nothing retired. Use <b>More \u2192 Retire</b> on a problem '
      + 'to take it off the review schedule without losing it.</p>';
    return;
  }

  el.innerHTML = list.map((r) => {
    const p = problems[r.slug] || { title: r.slug };
    const when = [...(r.history || [])].reverse().find((h) => h.action === 'retire')?.on;
    return `
      <div class="db-item" data-slug="${escapeHtml(r.slug)}" data-off="1">
        <div class="db-main">
          <a class="q-title" href="${problemUrl(r.slug, meta.host, p)}" target="_blank" rel="noreferrer">${titleLine(p, r.slug)}</a>
          ${patternChips(p) ? `<span class="q-meta">${patternChips(p)}</span>` : ''}
        </div>
        ${p.difficulty ? `<span class="tag" data-d="${p.difficulty}">${p.difficulty}</span>` : ''}
        <span class="db-when">${when ? `retired ${relativeDay(when, today)}` : ''}</span>
        <button class="btn btn-sm" data-act="restore" title="Put this back on the review schedule">Restore</button>
      </div>`;
  }).join('');
}

/**
 * One handler for every per-problem button, in the queue and in recent solves
 * alike.
 */
async function runAction(btn) {
  const host = btn.closest('[data-slug]');
  const slug = host?.dataset.slug;
  if (!slug) return;
  const action = btn.dataset.act;
  view.openMenu = null;

  if (action === 'flag' || action === 'unflag') {
    btn.disabled = true;
    await setNeedsReview(slug, action === 'flag');
    tip.hide();
    await load();
    return;
  }

  if (action === 'untag' || action === 'retag') {
    btn.disabled = true;
    if (action === 'untag') await setTagHidden(slug, btn.dataset.tag, true);
    else await restoreTags(slug);
    tip.hide();
    // The menu is reopened after the re-render: removing three wrong tags
    // shouldn't mean opening the same menu three times.
    const list = host.closest('#queue, #recent, #retired, #problems')?.id;
    if (list) view.openMenu = { slug, list };
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

  btn.disabled = true;
  await reviewAction(slug, action);
  tip.hide();
  await load();
}

for (const sel of ['#queue', '#recent', '#retired', '#problems']) {
  $(sel).addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) runAction(btn);
  });
}

// `important` / `struggling` toggles: their own control, separate from the
// verdict and menu actions above, since they mark the review rather than
// judging a sitting.
$('#queue').addEventListener('click', async (e) => {
  const flagBtn = e.target.closest('[data-flag]');
  if (!flagBtn) return;
  const slug = flagBtn.closest('[data-slug]')?.dataset.slug;
  if (!slug) return;
  flagBtn.disabled = true;
  await setReviewFlag(slug, flagBtn.dataset.flag, flagBtn.getAttribute('aria-pressed') !== 'true');
  tip.hide();
  await load();
});

// The count boxes double as a way back: clicking "due today" reselects today.
$('#rev-counts').addEventListener('click', (e) => {
  const key = e.target.closest('[data-day]')?.dataset.day;
  if (!key || key === view.selected) return;
  view.selected = key;
  view.month = key.slice(0, 7);
  render(todayNow());
});

// ---- drag a queue row onto the calendar ----
$('#queue').addEventListener('dragstart', (e) => {
  const row = e.target.closest?.('tr[data-slug]');
  if (!row) return;
  e.dataTransfer.setData(DRAG_TYPE, row.dataset.slug);
  e.dataTransfer.effectAllowed = 'move';
  row.classList.add('dragging');
  document.body.classList.add('is-dragging');
  tip.hide();
});
$('#queue').addEventListener('dragend', (e) => {
  e.target.closest?.('tr')?.classList.remove('dragging');
  document.body.classList.remove('is-dragging');
});

// ---- row menus ----
// The popover is pinned to the viewport rather than to its row. Positioned
// inside the queue's scroll wrapper it was clipped by it, and opening one
// near the bottom scrolled the table instead of showing the menu. Here it
// opens below the button, or above it when there's more room there, and
// scrolls itself if it is still too tall.
function placeMenu(menu) {
  const pop = menu.querySelector('.menu-pop');
  const btn = menu.querySelector('summary');
  if (!pop || !btn) return;
  const gap = 4;
  const edge = 8;
  const r = btn.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const width = Math.min(260, vw - edge * 2);
  pop.style.width = `${width}px`;
  pop.style.left = `${Math.min(Math.max(edge, r.right - width), vw - width - edge)}px`;

  const below = vh - r.bottom - gap - edge;
  const above = r.top - gap - edge;
  pop.style.maxHeight = '';
  const natural = pop.scrollHeight;
  if (natural <= below || below >= above) {
    pop.style.top = `${r.bottom + gap}px`;
    pop.style.bottom = '';
    pop.style.maxHeight = `${Math.max(below, 120)}px`;
  } else {
    pop.style.top = '';
    pop.style.bottom = `${vh - r.top + gap}px`;
    pop.style.maxHeight = `${above}px`;
  }
}

// `toggle` doesn't bubble, so listen in the capture phase.
document.addEventListener('toggle', (e) => {
  const menu = e.target;
  if (!(menu instanceof HTMLDetailsElement) || !menu.classList.contains('menu') || !menu.open) return;
  // One at a time: a second menu opening over the first is never wanted.
  for (const other of document.querySelectorAll('.menu[open]')) if (other !== menu) other.open = false;
  placeMenu(menu);
}, true);

// Follow the button while the page scrolls rather than floating loose.
const replaceOpenMenus = () => document.querySelectorAll('.menu[open]').forEach(placeMenu);
window.addEventListener('scroll', replaceOpenMenus, { passive: true, capture: true });
window.addEventListener('resize', replaceOpenMenus);

// A row menu left open would sit over the row beneath it after a re-render.
document.addEventListener('click', (e) => {
  // A click that re-rendered its own row — a tag edit — reaches this listener
  // after the re-render, because the promise chain drains between listeners.
  // The clicked node is detached by then and the menus on screen are new ones,
  // so "did the click land outside them" is a question about a DOM that no
  // longer exists; answering it would slam the menu the re-render just
  // reopened.
  if (!e.target.isConnected) return;
  for (const menu of document.querySelectorAll('.menu[open]')) {
    if (!menu.contains(e.target)) {
      menu.open = false;
      view.openMenu = null;
    }
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const menu of document.querySelectorAll('.menu[open]')) menu.open = false;
  view.openMenu = null;
});

// ---- problem index ----
const todayNow = () => todayKey(state.settings.timezone, state.settings.dayStartHour);

// Only the index is redrawn while typing: a full render would rebuild the
// selects around the search box, and the caret would have to survive that on
// every keystroke.
$('#db-q').addEventListener('input', (e) => {
  view.q = e.target.value;
  view.dbLimit = DB_PAGE;
  renderProblems(todayNow());
});

$('#db-status').addEventListener('change', (e) => {
  view.status = e.target.value;
  view.dbLimit = DB_PAGE;
  renderProblems(todayNow());
});

$('#db-sort').addEventListener('change', (e) => {
  view.sort = e.target.value;
  renderProblems(todayNow());
});

$('#problems').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-db]');
  if (!btn) return;
  if (btn.dataset.db === 'more') {
    view.dbLimit = (view.dbLimit || DB_PAGE) + DB_PAGE;
    renderProblems(todayNow());
    return;
  }
  // "Clear the search and filters".
  view.q = '';
  $('#db-q').value = '';
  view.status = 'all';
  view.dbLimit = DB_PAGE;
  setFilter({ group: 'all', difficulty: 'all' });
});

$('#db-group').addEventListener('change', (e) => {
  view.dbLimit = DB_PAGE;
  setFilter({ group: e.target.value });
});
$('#db-diff').addEventListener('change', (e) => {
  view.dbLimit = DB_PAGE;
  setFilter({ difficulty: e.target.value });
});

// A pattern in the breakdown is a group: clicking one narrows the problem
// list below it, and clicking it again clears that.
$('#patterns').addEventListener('click', (e) => {
  const row = e.target.closest('[data-group]');
  if (!row) return;
  const tag = row.dataset.group;
  view.dbLimit = DB_PAGE;
  setFilter({ group: view.group === tag ? 'all' : tag });
});

// A solve recorded on LeetCode or NeetCode lands in storage from the service
// worker; redraw so the streak and queue catch up without a page reload.
// Debounced because one solve writes several keys in quick succession.
let reloadTimer = null;
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!Object.keys(changes).some((k) => k.startsWith('leettrack:'))) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => load().catch(() => {}), 150);
});

// ---- tabs ----
for (const btn of document.querySelectorAll('.tab-btn')) {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
}

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
  // A two-way switch. "Match system" is still there in Settings.
  const next = isDark() ? 'light' : 'dark';
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

// ---- manual add ----
$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#add-slug');
  const msg = $('#add-msg');
  const raw = input.value.trim();
  if (!raw) return;

  const parsed = parseSlug(raw);
  if (!parsed) {
    msg.textContent = 'Enter a problem slug or a LeetCode / NeetCode URL.';
    msg.dataset.ok = '0';
    return;
  }

  const { slug, neetcode } = parsed;
  const fallbackTitle = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const res = await recordSubmission({
    id: `manual-${slug}-${Date.now()}`,
    slug,
    title: fallbackTitle,
    at: Date.now(),
    verdict: 'Accepted',
    source: neetcode ? 'manual-neetcode' : 'manual',
  });

  if (res.added) {
    msg.textContent = `Added ${fallbackTitle}. Fetching details…`;
    msg.dataset.ok = '1';
    input.value = '';
    await load();
    // Enrich in the background — NeetCode first (has its own metadata),
    // then LeetCode as a fallback for number/tags it might know better.
    enrichManual(slug).then(() => load()).catch(() => {});
  } else {
    msg.textContent = `${fallbackTitle} already tracked — recorded another solve.`;
    msg.dataset.ok = '1';
    input.value = '';
  }
  setTimeout(() => { msg.textContent = ''; }, 4000);
});

async function enrichManual(slug) {
  // NeetCode's metadata API first — works for any NeetCode problem.
  const nc = await fetchNeetCodeMeta(slug).catch(() => null);
  if (nc) {
    await enrichProblem(slug, {
      title: nc.name,
      difficulty: nc.difficulty,
      topicTags: nc.topics || [],
    });
  }
  // Then LeetCode, via the service worker, for the problem number — and to
  // find out whether LeetCode has the problem at all. If it doesn't, it's
  // marked NeetCode-only and its links go to NeetCode.
  await new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'leettrack:enrich', slug },
      () => { void chrome.runtime.lastError; resolve(); },
    );
  });
}

async function fetchNeetCodeMeta(slug) {
  const res = await fetch('https://neetcode.io/api/getProblemMetadataFunctionHttp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { problemId: slug } }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const d = json?.data || json?.result;
  if (!d || !d.name) return null;
  return d;
}

function parseSlug(raw) {
  // Full URL: neetcode.io/problems/… or leetcode.com/problems/…
  const ncMatch = /neetcode\.io\/problems\/([a-z0-9-]+)/.exec(raw);
  if (ncMatch) return { slug: ncMatch[1], neetcode: true };
  const lcMatch = /(?:leetcode\.com|leetcode\.cn)\/problems\/([a-z0-9-]+)/.exec(raw);
  if (lcMatch) return { slug: lcMatch[1], neetcode: false };
  // Bare slug: only lowercase, digits, hyphens
  if (/^[a-z0-9]([a-z0-9-]{0,118}[a-z0-9])?$/.test(raw)) return { slug: raw, neetcode: false };
  return null;
}

load().catch((err) => {
  document.querySelector('#main').insertAdjacentHTML('afterbegin',
    `<p class="empty">Could not load data: ${escapeHtml(err.message)}</p>`);
});

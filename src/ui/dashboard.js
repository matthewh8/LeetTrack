import {
  readAll, saveSettings, reviewAction, setNeedsReview, setRetired, syncDayWindow,
  setTagHidden, restoreTags, setReviewFlag, exportAll, importAll, resetHistoryFrom, normaliseDayKey,
} from '../lib/storage.js';
import { todayKey, dayKey, addDays, diffDays, hourLabel } from '../lib/time.js';
import { computeStreak } from '../lib/streak.js';
import {
  dueBy, dueCountsByDay, flaggedReviews, retiredReviews, activeReviews,
  intervalAt, normaliseDelay, DELAY_PRESETS,
} from '../lib/scheduler.js';
import { difficultyCounts, recentSolves, DIFFICULTIES } from '../lib/stats.js';
import {
  problemRows, searchProblems, STATUS_FILTERS, SORTS,
} from '../lib/search.js';
import {
  patternsOf, patternCounts, tagCounts, visibleTags, hiddenTags, hasTag,
} from '../lib/patterns.js';
import { renderHeatmap } from './components/heatmap.js';
import { renderCalendar } from './components/calendar.js';
import { createTooltip } from './components/tooltip.js';

const $ = (sel) => document.querySelector(sel);
const tip = createTooltip();

const view = {
  month: null, selected: null, showAllQueue: false, openMenu: null,
  // Group filter: a topic tag and a difficulty, both 'all' when off. It applies
  // to the whole Reviews card — calendar, count, and queue — because a calendar
  // that disagreed with the list under it would just be a bug you have to
  // remember.
  group: 'all', difficulty: 'all',
  // All problems: its own text search, status filter and sort order. The group
  // and difficulty above are shared with the Reviews card rather than
  // duplicated — one filter, two places it is shown and can be set.
  q: '', status: 'all', sort: 'recent', dbLimit: 0,
};

const DB_PAGE = 25;
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
  // Everything in this card is drawn from the filtered set, so the calendar,
  // the count, and the list can never tell three different stories.
  renderFilters();
  const shown = filterReviews(reviews);
  const due = dueBy(shown, today);
  const counts = dueCountsByDay(shown);
  $('#due-n').textContent = due.length;
  const overdue = due.filter((r) => r.dueOn < today && !r.needsReview).length;
  const flagged = flaggedReviews(shown).length;
  const notes = [];
  if (overdue) notes.push(`${overdue} overdue`);
  if (flagged) notes.push(`${flagged} marked needs review`);
  $('#due-sub').textContent = !Object.keys(reviews).length
    ? 'Reviews are scheduled automatically when you solve something.'
    : due.length
      ? (notes.length ? notes.join(' · ') : 'Scheduled for today')
      : filterActive()
        ? 'Nothing due in this group.'
        : 'Nothing due — next one is later.';

  const upcoming = activeReviews(shown)
    .filter((r) => r.dueOn > today)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
  const scheduled = activeReviews(shown).length;
  const total = activeReviews(reviews).length;
  $('#rev-note').textContent = [
    filterActive()
      ? `${scheduled} of ${total} on the schedule`
      : (scheduled ? `${scheduled} on the schedule` : ''),
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
            <a class="q-title" href="${problemUrl(p.slug, meta.host)}" target="_blank" rel="noreferrer">${titleLine(p, p.slug)}</a>
            ${patternChips(p) ? `<span class="q-meta">${patternChips(p)}</span>` : ''}
          </div>
          ${p.difficulty ? `<span class="tag" data-d="${p.difficulty}">${p.difficulty}</span>` : ''}
          <span class="r-when">${relativeDay(dayOf(p.lastSolvedAt, state.settings.timezone), today)}</span>
          ${flagButton(reviews[p.slug])}
          ${recentMenu(p.slug, reviews[p.slug], settings.intervals)}
        </div>`).join('')
    : '<p class="empty">Solve a problem on LeetCode and it will appear here.</p>';

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

// ---- group filter ----

const filterActive = () => view.group !== 'all' || view.difficulty !== 'all';

function matchesFilter(problem) {
  if (view.group !== 'all' && !hasTag(problem, view.group)) return false;
  if (view.difficulty !== 'all' && (problem?.difficulty || 'Unknown') !== view.difficulty) return false;
  return true;
}

/** The reviews the current filter lets through, keyed by slug as they came. */
function filterReviews(reviews) {
  if (!filterActive()) return reviews;
  const out = {};
  for (const [slug, r] of Object.entries(reviews)) {
    if (matchesFilter(state.problems[slug])) out[slug] = r;
  }
  return out;
}

/**
 * The group and difficulty selects, drawn twice: above the calendar and above
 * the problem index. One filter state, two places to see and set it.
 *
 * Options come from every tracked problem, not just the scheduled ones. The
 * rule is still that a tag which could only ever return an empty list is worse
 * than no tag at all — but the index lists removed and unscheduled problems
 * too, so a tag that only appears on those now has somewhere to land. The count
 * describes the group itself, which is why the Reviews card can show fewer rows
 * than the number beside the tag it is filtered to.
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
  for (const sel of [$('#f-group'), $('#db-group')]) {
    sel.innerHTML = groupHtml;
    sel.value = view.group;
  }

  const present = [...DIFFICULTIES, 'Unknown']
    .map((d) => ({ d, n: Object.values(problems).filter((p) => (p.difficulty || 'Unknown') === d).length }))
    .filter(({ d, n }) => n || d === view.difficulty);
  const diffHtml = `<option value="all">Any difficulty</option>`
    + present.map(({ d, n }) => `<option value="${d}">${d} (${n})</option>`).join('');
  for (const sel of [$('#f-diff'), $('#db-diff')]) {
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

  $('#btn-filter-clear').hidden = !filterActive();
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
      title="Show only ${escapeHtml(c.tag)} reviews">
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
 * The overflow menu on a queue row: everything that isn't Done or Again.
 * `compact` drops the scheduling half, for rows that aren't due — there is
 * nothing to push back, but you may well want the problem off the schedule.
 */
function moreMenu(slug, review, intervals, { compact = false } = {}) {
  const cycle = review ? intervalAt(intervals, review.stage) : 0;
  const schedule = !review ? '' : `
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
        ${tagEditor(slug)}
        ${review ? `
        <button type="button" class="menu-item" data-act="retire">
          Remove from review
          <span class="menu-hint">Off the calendar. Stays in your solved history.</span>
        </button>` : ''}
      </div>
    </details>`;
}

/**
 * The same menu on a recent solve, where the useful action is "stop asking me
 * about this one" — you have just seen it and know whether it needs revisiting.
 */
function recentMenu(slug, review, intervals) {
  if (review?.retired) {
    return `<button class="btn btn-sm" data-act="restore" title="Put this back on the review schedule">Restore</button>`;
  }
  return moreMenu(slug, review, intervals, { compact: true });
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
    el.innerHTML = '<p class="empty">Nothing tracked yet. Solve a problem on LeetCode '
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
          <a class="q-title" href="${problemUrl(r.slug, meta.host)}" target="_blank" rel="noreferrer">${titleLine(p, r.slug)}</a>
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
        ${recentMenu(r.slug, r.review, settings.intervals)}
      </div>`;
  }).join('')
    + (found.length > shown.length
      ? `<p class="q-more"><button class="linkish" data-db="more">Show ${
          Math.min(DB_PAGE, found.length - shown.length)} more of ${found.length}</button></p>`
      : '');
}

const QUEUE_PREVIEW = 10;

function renderQueue(today, counts) {
  const { reviews, problems, settings, meta } = state;
  const shown = filterReviews(reviews);
  const showingToday = view.selected === today;
  const all = showingToday
    ? dueBy(shown, today)
    : activeReviews(shown).filter((r) => r.dueOn === view.selected);

  const inGroup = filterActive()
    ? ` <span class="q-filter">in ${escapeHtml([
        view.group === 'all' ? '' : view.group,
        view.difficulty === 'all' ? '' : view.difficulty,
      ].filter(Boolean).join(' · '))}</span>`
    : '';
  const heading = showingToday ? 'Due today' : `Scheduled for ${view.selected}`;

  const el = $('#queue');
  if (!all.length) {
    el.innerHTML = `<h3>${heading}${inGroup}</h3><p class="empty">${
      filterActive()
        ? 'Nothing here in this group.'
        : showingToday ? 'Nothing due. Enjoy the day off.' : 'Nothing scheduled for this day.'
    }</p>`;
    return;
  }

  // A long overdue pile would push the rest of the page out of reach, so only
  // the first screenful is drawn until asked otherwise.
  const list = view.showAllQueue ? all : all.slice(0, QUEUE_PREVIEW);

  el.innerHTML = `<h3>${heading}${inGroup} · ${all.length}</h3>` + list.map((r) => {
    const p = problems[r.slug] || { title: r.slug };
    const late = r.dueOn < today;
    const when = late
      ? `<span class="overdue">due ${relativeDay(r.dueOn, today)}</span>`
      : `<span>${r.dueOn === today ? `stage ${r.stage + 1}` : `due ${relativeDay(r.dueOn, today)}`}</span>`;
    // What each of the two "I knew it" buttons schedules, spelled out rather
    // than left for you to work out from the ladder.
    const nextUp = intervalAt(settings.intervals, r.stage + 1);
    const afterAce = intervalAt(settings.intervals, r.stage + 3);
    return `
      <div class="q-item" data-slug="${escapeHtml(r.slug)}"${r.needsReview ? ' data-flagged="1"' : ''}>
        <div class="q-flags">
          <button class="q-flag" data-flag="important" aria-pressed="${!!r.important}"
                  title="Must-do — keeps this at the top of the queue">★</button>
          <button class="q-flag" data-flag="struggling" aria-pressed="${!!r.struggling}"
                  title="Struggling with this one">⚑</button>
        </div>
        <div class="q-main">
          <a class="q-title" href="${problemUrl(r.slug, meta.host)}" target="_blank" rel="noreferrer">${titleLine(p, r.slug)}</a>
          <span class="q-meta">${r.needsReview ? '<span class="flagged">Needs review</span>' : ''}${when}${patternChips(p)}</span>
        </div>
        ${p.difficulty ? `<span class="tag" data-d="${p.difficulty}">${p.difficulty}</span>` : ''}
        <div class="q-actions">
          <button class="btn btn-sm btn-primary" data-act="done"
            title="Reviewed — next rung of the ladder, back in ${nextUp} days">Done</button>
          <button class="btn btn-sm btn-ace" data-act="ace"
            title="Nailed it — skips a cycle. Still back in ${nextUp} days, but two rungs up, so the review after that is ${afterAce} days out.">Nailed it</button>
          <button class="btn btn-sm" data-act="again">Again</button>
          ${moreMenu(r.slug, r, settings.intervals)}
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
            <a class="retired-title" href="${problemUrl(r.slug, meta.host)}" target="_blank" rel="noreferrer">${titleLine(p, r.slug)}</a>
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

// A delay menu left open would sit over the row beneath it after a re-render.
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
  // "Clear the search and filters" — the group and difficulty are shared, so
  // this resets the Reviews card with it. That is the honest behaviour: leaving
  // them set would mean the index still hid rows after saying it cleared.
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

// ---- group filter ----
$('#f-group').addEventListener('change', (e) => setFilter({ group: e.target.value }));
$('#f-diff').addEventListener('change', (e) => setFilter({ difficulty: e.target.value }));
$('#btn-filter-clear').addEventListener('click', () => setFilter({ group: 'all', difficulty: 'all' }));

// A pattern in the breakdown is a group: clicking one filters the reviews by
// it, and clicking it again clears the filter.
$('#patterns').addEventListener('click', (e) => {
  const row = e.target.closest('[data-group]');
  if (!row) return;
  const tag = row.dataset.group;
  setFilter({ group: view.group === tag ? 'all' : tag });
  $('#rev-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
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

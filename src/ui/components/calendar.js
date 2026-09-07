// Month grid of review load. A dot's size is not the encoding — the count is
// printed — so the calendar stays readable for colorblind and low-vision users.

import { monthDays, weekdayOf, shiftMonth } from '../../lib/time.js';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function renderCalendar(root, { monthKey, dueCounts, today, selected, onSelect, onMonth, tip }) {
  const head = document.createElement('div');
  head.className = 'cal-head';
  const label = new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
  head.innerHTML = `
    <button class="btn btn-sm" data-nav="-1" aria-label="Previous month">‹</button>
    <strong>${label}</strong>
    <span class="cal-nav-right">
      <button class="btn btn-sm" data-nav="1" aria-label="Next month">›</button>
      <button class="btn btn-sm" data-nav="today">Today</button>
    </span>`;
  head.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]')?.dataset.nav;
    if (!nav) return;
    onMonth(nav === 'today' ? today.slice(0, 7) : shiftMonth(monthKey, Number(nav)));
  });

  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  for (const d of DOW) {
    const h = document.createElement('span');
    h.className = 'cal-dow';
    h.textContent = d;
    grid.appendChild(h);
  }

  const keys = monthDays(monthKey);
  for (let i = 0; i < weekdayOf(keys[0]); i += 1) {
    grid.appendChild(Object.assign(document.createElement('span'), { className: 'cal-pad' }));
  }

  for (const key of keys) {
    const count = dueCounts[key] || 0;
    const cell = document.createElement('button');
    cell.className = 'cal-day';
    cell.type = 'button';
    cell.dataset.key = key;
    if (key === today) cell.dataset.today = '1';
    if (key === selected) cell.dataset.selected = '1';
    if (count) cell.dataset.due = '1';
    cell.innerHTML = `<span class="cal-n tabular">${Number(key.slice(8))}</span>` +
      (count ? `<span class="cal-badge tabular">${count}</span>` : '');
    const text = count ? `${count} review${count === 1 ? '' : 's'} due` : 'Nothing due';
    cell.setAttribute('aria-label', `${key}, ${text}`);
    if (tip) tip.bind(cell, () => `<b>${key}</b><br><span class="t-sub">${text}</span>`);
    cell.addEventListener('click', () => onSelect(key));
    grid.appendChild(cell);
  }

  // The month's own total, because the point of a month view is the shape of
  // the load ahead and counting 30 badges by eye is not that.
  const total = keys.reduce((sum, k) => sum + (dueCounts[k] || 0), 0);
  const foot = document.createElement('p');
  foot.className = 'cal-foot';
  foot.textContent = total
    ? `${total} review${total === 1 ? '' : 's'} this month`
    : 'Nothing scheduled this month';

  root.replaceChildren(head, grid, foot);
}

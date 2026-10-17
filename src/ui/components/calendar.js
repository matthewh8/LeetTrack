// Month grid of review load. A dot's size is not the encoding — the count is
// printed — so the calendar stays readable for colorblind and low-vision users.

import { monthDays, weekdayOf, shiftMonth } from '../../lib/time.js';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// The MIME type a queue row puts on a drag. Anything else dropped on the
// calendar — a link, a file, text from another tab — is ignored.
export const DRAG_TYPE = 'application/x-leettrack-slug';

const isOurs = (e) => e.dataTransfer?.types?.includes(DRAG_TYPE);

export function renderCalendar(root, { monthKey, dueCounts, today, selected, onSelect, onMonth, onDrop, tip }) {
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

  // Holding a dragged problem over ‹ or › turns the page, so a review can be
  // carried into next month without letting go of it.
  let flip = null;
  const stopFlip = () => { clearTimeout(flip); flip = null; };
  head.addEventListener('dragover', (e) => {
    const nav = e.target.closest('[data-nav="-1"], [data-nav="1"]')?.dataset.nav;
    if (!nav || !isOurs(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!flip) flip = setTimeout(() => { flip = null; onMonth(shiftMonth(monthKey, Number(nav))); }, 550);
  });
  head.addEventListener('dragleave', stopFlip);
  head.addEventListener('drop', stopFlip);

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
    if (onDrop && key >= today) {
      cell.dataset.drop = '1';
      cell.addEventListener('dragover', (e) => {
        if (!isOurs(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        cell.dataset.over = '1';
      });
      cell.addEventListener('dragleave', () => { delete cell.dataset.over; });
      cell.addEventListener('drop', (e) => {
        if (!isOurs(e)) return;
        e.preventDefault();
        delete cell.dataset.over;
        const slug = e.dataTransfer.getData(DRAG_TYPE);
        if (slug) onDrop(key, slug);
      });
    }
    grid.appendChild(cell);
  }

  const parts = [head, grid];
  if (onDrop) {
    const hint = document.createElement('p');
    hint.className = 'cal-hint';
    hint.textContent = 'Drag a review onto a day to move it. Its cycle stays the same.';
    parts.push(hint);
  }
  root.replaceChildren(...parts);
}

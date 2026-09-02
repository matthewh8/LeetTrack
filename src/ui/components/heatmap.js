// Contribution heatmap: one column per week, one row per weekday.
// Sequential encoding — a single hue, light to dark with magnitude.

import { addDays, weekdayOf, monthOf } from '../../lib/time.js';
import { heatLevel } from '../../lib/stats.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function renderHeatmap(root, { days, endKey, weeks = 52, tip }) {
  // Wind back to the Sunday that starts the first visible week so rows align.
  let start = addDays(endKey, -(weeks * 7 - 1));
  start = addDays(start, -weekdayOf(start));

  const cols = [];
  for (let w = 0; w < weeks + 1; w += 1) {
    const col = [];
    for (let d = 0; d < 7; d += 1) {
      const key = addDays(start, w * 7 + d);
      if (key > endKey) break;
      col.push(key);
    }
    if (col.length) cols.push(col);
  }

  root.style.setProperty('--cols', String(cols.length));

  const grid = document.createElement('div');
  grid.className = 'hm-grid';
  grid.setAttribute('role', 'img');

  const labels = document.createElement('div');
  labels.className = 'hm-months';

  let lastMonth = null;
  cols.forEach((col, i) => {
    const colEl = document.createElement('div');
    colEl.className = 'hm-col';

    const m = monthOf(col[0]);
    const label = document.createElement('span');
    label.className = 'hm-month';
    label.style.gridColumn = `${i + 1}`;
    // Label a column only when its month differs from the previous one.
    label.textContent = m !== lastMonth && i < cols.length - 1 ? MONTHS[Number(m.slice(5)) - 1] : '';
    lastMonth = m;
    labels.appendChild(label);

    for (const key of col) {
      const d = days[key] || {};
      const solved = d.solved || 0;
      const level = heatLevel(solved);
      const cell = document.createElement('div');
      cell.className = 'hm-cell';
      cell.dataset.level = String(level);
      if (key === endKey) cell.dataset.today = '1';
      cell.tabIndex = -1;

      const text = solved
        ? `${solved} problem${solved === 1 ? '' : 's'} solved`
        : (d.attempts ? `${d.attempts} attempt${d.attempts === 1 ? '' : 's'}, none solved` : 'No activity');
      const title = `${key} — ${text}`;
      cell.setAttribute('aria-label', title);
      if (tip) tip.bind(cell, () => `<b>${key}</b><br><span class="t-sub">${text}</span>`);
      else cell.title = title;

      colEl.appendChild(cell);
    }
    grid.appendChild(colEl);
  });

  const total = Object.keys(days).reduce((s, k) => (k <= endKey && k >= start ? s + (days[k].solved || 0) : s), 0);
  grid.setAttribute('aria-label', `Activity heatmap, ${total} problems solved in the last ${weeks} weeks`);

  const legend = document.createElement('div');
  legend.className = 'hm-legend';
  legend.innerHTML =
    `<span>Less</span>${[0, 1, 2, 3, 4].map((l) => `<i class="hm-cell" data-level="${l}"></i>`).join('')}<span>More</span>`;

  root.replaceChildren(labels, grid, legend);
}

// Accepted vs wrong answers per day, as a diverging column chart.
//
// Accepted grows up from the baseline, wrong grows down. Direction is the
// primary encoding — green and red are only ~4 dE apart under deuteranopia, so
// hue here is redundant reinforcement, never the signal.

const UP_PX = 58;
const DOWN_PX = 34;

export function renderVerdictChart(root, { series, tip }) {
  const maxUp = Math.max(1, ...series.map((d) => d.accepted));
  const maxDown = Math.max(1, ...series.map((d) => d.wrong));

  const plot = document.createElement('div');
  plot.className = 'vc';
  plot.style.setProperty('--up', `${UP_PX}px`);
  plot.style.setProperty('--down', `${DOWN_PX}px`);

  for (const d of series) {
    const col = document.createElement('div');
    col.className = 'vc-col';
    if (d.attempts === 0) col.dataset.empty = '1';

    const up = document.createElement('div');
    up.className = 'vc-up';
    if (d.accepted) {
      const bar = document.createElement('i');
      bar.style.height = `${Math.max(3, (d.accepted / maxUp) * UP_PX)}px`;
      up.appendChild(bar);
    }

    const down = document.createElement('div');
    down.className = 'vc-down';
    if (d.wrong) {
      const bar = document.createElement('i');
      bar.style.height = `${Math.max(3, (d.wrong / maxDown) * DOWN_PX)}px`;
      down.appendChild(bar);
    }

    col.append(up, down);

    const label = d.attempts
      ? `${d.accepted} accepted · ${d.wrong} wrong`
      : 'No submissions';
    col.setAttribute('aria-label', `${d.key}: ${label}`);
    if (tip) tip.bind(col, () => `<b>${d.key}</b><br><span class="t-sub">${label}</span>`);
    plot.appendChild(col);
  }

  const axis = document.createElement('div');
  axis.className = 'vc-axis';
  axis.innerHTML = `<span>${series[0]?.key.slice(5) ?? ''}</span><span>${series.at(-1)?.key.slice(5) ?? ''}</span>`;

  const legend = document.createElement('div');
  legend.className = 'vc-legend';
  legend.innerHTML = `
    <span><i class="sw" data-v="ac"></i>Accepted <span class="t-sub">(above)</span></span>
    <span><i class="sw" data-v="wa"></i>Wrong answer <span class="t-sub">(below)</span></span>`;

  root.replaceChildren(plot, axis, legend);
}

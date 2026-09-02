// One shared hover layer for every chart on the page.

export function createTooltip() {
  const el = document.createElement('div');
  el.id = 'tip';
  el.setAttribute('role', 'tooltip');
  document.body.appendChild(el);

  let raf = 0;
  const place = (e) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const pad = 12;
      const r = el.getBoundingClientRect();
      let x = e.clientX + pad;
      let y = e.clientY + pad;
      if (x + r.width > innerWidth - 4) x = e.clientX - r.width - pad;
      if (y + r.height > innerHeight - 4) y = e.clientY - r.height - pad;
      el.style.left = `${Math.max(4, x)}px`;
      el.style.top = `${Math.max(4, y)}px`;
    });
  };

  const hide = () => {
    el.dataset.show = '0';
  };

  return {
    /** @param {Element} target @param {() => string} html */
    bind(target, html) {
      target.addEventListener('pointerenter', (e) => {
        el.innerHTML = html();
        el.dataset.show = '1';
        place(e);
      });
      target.addEventListener('pointermove', place);
      target.addEventListener('pointerleave', hide);
    },
    hide,
  };
}

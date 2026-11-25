/* Sell-your-car 3-step valuation form (front-end only; connect your reg lookup / CRM). */
(function () {
  const f = document.querySelector('[data-valuation]'); if (!f) return;
  let step = 1;
  f.addEventListener('click', e => {
    if (!e.target.closest('[data-next]')) return;
    const reg = f.querySelector('.plate input');
    if (step === 1 && !reg.value.trim()) { reg.focus(); return; }
    step = Math.min(3, step + 1);
    f.querySelectorAll('[data-pane]').forEach(p => p.hidden = +p.dataset.pane !== step);
    f.querySelectorAll('[data-st]').forEach(s => s.classList.toggle('on', +s.dataset.st <= step));
  });
  const pre = new URLSearchParams(location.search).get('reg'); if (pre) f.querySelector('.plate input').value = pre.toUpperCase();
})();

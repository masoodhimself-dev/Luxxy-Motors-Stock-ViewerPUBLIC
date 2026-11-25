/* Finance calculator (illustrative). Amortised monthly payment at an example APR. */
window.BORZ_READY.then(function () {
  const root = document.querySelector('[data-calc]'); if (!root) return;
  const APR = 12.9, { gbp, monthlyPayment } = window.SITE;
  const q = s => root.querySelector(s), price = q('[data-in="price"]'), dep = q('[data-in="dep"]');
  let term = 48;
  function fill(el) { el.style.setProperty('--pct', ((el.value - el.min) / (el.max - el.min) * 100) + '%'); }
  function calc() {
    if (+dep.value > +price.value * .9) dep.value = Math.round(price.value * .9 / 100) * 100;
    const P = price.value - dep.value;
    const mo = monthlyPayment(P, term, APR), total = mo * term + +dep.value;
    const out = (k, v) => q(`[data-out="${k}"]`).textContent = v;
    out('price', gbp(price.value)); out('dep', gbp(dep.value)); out('mo', gbp(mo)); out('fin', gbp(P));
    out('cost', gbp(mo * term - P)); out('total', gbp(total)); out('terms', `over ${term} months · ${APR}% example APR · illustration only`);
    fill(price); fill(dep);
  }
  [price, dep].forEach(el => el.addEventListener('input', calc));
  root.querySelectorAll('[data-term]').forEach(b => b.addEventListener('click', () => {
    term = +b.dataset.term; root.querySelectorAll('[data-term]').forEach(x => x.classList.toggle('is-active', x === b)); calc();
  }));
  calc();
});

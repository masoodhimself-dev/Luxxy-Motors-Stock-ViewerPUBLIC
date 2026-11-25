/* Stock list: make chips, quick filters, sort, pagination, mobile filter drawer. */
window.BORZ_READY.then(function ({ stockUnavailable }) {
  const { STOCK, card, title, html, updateCounts } = window.SITE;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const PER = 12, params = new URLSearchParams(location.search);
  const state = {
    make: params.get('make') || '', q: params.get('q') || '', body: params.get('bodyType') || params.get('body') || '',
    fuel: params.get('fuel') || '', gear: params.get('transmission') || params.get('gear') || '',
    max: Number(params.get('maxPrice') || params.get('max')) || 0, sort: 'new', page: 1,
  };

  function chips() {
    const counts = Object.create(null); STOCK.forEach(v => { if (v.make) counts[v.make] = (counts[v.make] || 0) + 1; });
    $('[data-chips]').innerHTML = `<button class="chip${state.make ? '' : ' is-active'}" data-make="">All makes <b>${STOCK.length}</b></button>` +
      Object.keys(counts).sort().map(m => `<button class="chip${state.make === m ? ' is-active' : ''}" data-make="${html(m)}">${window.makeLogo && window.makeLogo(m) ? `<span class="chip-logo" aria-hidden="true" style="-webkit-mask-image:url(${window.makeLogo(m)});mask-image:url(${window.makeLogo(m)})"></span>` : ''}${html(m)} <b>${counts[m]}</b></button>`).join('');
  }
  const filterFields = { body: 'body', fuel: 'fuel', gear: 'gear' };
  for (const [key, field] of Object.entries(filterFields)) {
    const values = [...new Set(STOCK.map(car => car[field]).filter(Boolean))].sort();
    $$('select[data-filter="' + key + '"]').forEach(select => {
      const label = select.options[0]?.textContent || key;
      select.replaceChildren(new Option(label, ''), ...values.map(value => new Option(value, value)));
    });
  }
  const compareNumber = (field, descending = false) => (a, b) => {
    if (a[field] === null) return b[field] === null ? 0 : 1;
    if (b[field] === null) return -1;
    return descending ? b[field] - a[field] : a[field] - b[field];
  };
  const sorters = {
    pl: compareNumber('price'),
    ph: compareNumber('price', true),
    ml: compareNumber('miles'),
    yn: compareNumber('year', true),
    new: (a, b) => b.listedAt.localeCompare(a.listedAt),
  };
  const includes = (query, value) => !query || String(value).toLowerCase() === query.toLowerCase();
  function results() {
    const q = state.q.trim().toLowerCase();
    return STOCK.filter(v => includes(state.make, v.make) && includes(state.body, v.body) && includes(state.fuel, v.fuel)
      && includes(state.gear, v.gear) && (!state.max || v.price !== null && v.price <= state.max)
      && (!q || [title(v), v.deriv, v.registration, v.fuel, v.gear].join(' ').toLowerCase().includes(q))
    ).sort(sorters[state.sort] || sorters.new);
  }
  function render() {
    chips();
    const r = results(), pages = Math.max(1, Math.ceil(r.length / PER));
    state.page = Math.min(state.page, pages);
    $('[data-grid]').innerHTML = r.slice((state.page - 1) * PER, state.page * PER).map(card).join('');
    const empty = $('[data-empty]');
    empty.hidden = r.length > 0;
    if (stockUnavailable) {
      empty.replaceChildren();
      const error = document.createElement('p');
      error.textContent = 'We could not load the stock. Please try again.';
      empty.append(error);
    }
    $('[data-result-text]').innerHTML = r.length ? `<strong>${r.length}</strong> cars match` : stockUnavailable ? 'Stock unavailable' : 'No cars match';
    $$('[data-result-count]').forEach(el => el.textContent = r.length);
    $('[data-pages]').innerHTML = pages > 1 ? Array.from({ length: pages }, (_, i) => `<button class="${i + 1 === state.page ? 'is-active' : ''}" data-page="${i + 1}">${i + 1}</button>`).join('') : '';
    $$('[data-filter]').forEach(el => { const k = el.dataset.filter; if (el.value !== String(state[k] || '')) el.value = state[k] || ''; });
    updateCounts();
  }
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-make]'); if (c) { state.make = c.dataset.make; state.page = 1; render(); }
    const p = e.target.closest('[data-page]'); if (p) { state.page = +p.dataset.page; render(); scrollTo({ top: 0, behavior: 'smooth' }); }
    if (e.target.closest('[data-reset]')) { Object.assign(state, { make: '', q: '', body: '', fuel: '', gear: '', max: 0, page: 1 }); render(); }
    if (e.target.closest('[data-open-filters]')) toggleDrawer(true);
    if (e.target.closest('[data-close-filters]') || e.target.matches('[data-scrim]')) toggleDrawer(false);
  });
  document.addEventListener('input', e => { const k = e.target.dataset.filter; if (k) { state[k] = e.target.value; state.page = 1; render(); } });
  $('[data-sort]').addEventListener('change', e => { state.sort = e.target.value; render(); });
  function toggleDrawer(open) { $('[data-fdrawer]').classList.toggle('is-open', open); $('[data-scrim]').classList.toggle('is-open', open); }
  render();
});

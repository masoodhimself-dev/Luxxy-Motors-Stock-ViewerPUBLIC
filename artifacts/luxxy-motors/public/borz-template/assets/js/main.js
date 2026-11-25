/* Shared site behaviour: header, drawer, mega menu, cookie banner, WhatsApp dock,
   scroll reveal, wishlist/compare storage and the vehicle card renderer. */
window.BORZ_READY.then(function (data) {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const { stock: STOCK, stockUnavailable } = data;
  const config = window.BORZ_CONFIG;
  const route = path => config.basePath + path;
  const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const gbp = n => '£' + Math.round(n).toLocaleString('en-GB');
  const price = v => {
    if (!v.price || /poa|price on application|no price/i.test(v.priceType || '')) return 'Ask for price';
    const amount = new Intl.NumberFormat('en-GB', { style: 'currency', currency: /^[A-Z]{3}$/.test(v.currency) ? v.currency : 'GBP', maximumFractionDigits: 0 }).format(v.price);
    return /\b(excl(?:uding)?\s+vat|plus vat|\+\s*vat|ex\s+vat)\b/i.test(v.priceType || '') ? amount + ' + VAT' : amount;
  };
  const title = v => (v.make && v.model ? v.make + ' ' + v.model : v.title || [v.make, v.model].filter(Boolean).join(' ')) || 'Vehicle';
  function vehicleHref(v) {
    if (!v.publicCode) return route('/vehicle/' + encodeURIComponent(v.id));
    const slug = title(v).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55).replace(/-+$/g, '') || 'car';
    return route('/cars/' + slug + '-' + v.publicCode);
  }
  const stockHref = make => route('/stock?' + new URLSearchParams({ make }).toString());
  const monthlyPayment = (amount, term, apr) => {
    if (amount <= 0) return 0;
    const rate = (1 + apr / 100) ** (1 / 12) - 1;
    return rate ? amount * rate / (1 - (1 + rate) ** -term) : amount / term;
  };
  // Lucide icons (lucide.dev, ISC), the same set the original site uses via lucide-react
  const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const I = {
    cal: svg("<path d=\"M8 2v3\"/> <path d=\"M16 2v3\"/> <rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/> <path d=\"M3 9h18\"/>"),
    gauge: svg("<path d=\"m12 14 4-4\"/> <path d=\"M3.34 19a10 10 0 1 1 17.32 0\"/>"),
    fuel: svg("<path d=\"M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-6.998a2 2 0 0 0-.59-1.42L18 5\"/> <path d=\"M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16\"/> <path d=\"M2 21h13\"/> <path d=\"M3 9h11\"/>"),
    gear: svg("<path d=\"M11 10.27 7 3.34\"/> <path d=\"m11 13.73-4 6.93\"/> <path d=\"M12 22v-2\"/> <path d=\"M12 2v2\"/> <path d=\"M14 12h8\"/> <path d=\"m17 20.66-1-1.73\"/> <path d=\"m17 3.34-1 1.73\"/> <path d=\"M2 12h2\"/> <path d=\"m20.66 17-1.73-1\"/> <path d=\"m20.66 7-1.73 1\"/> <path d=\"m3.34 17 1.73-1\"/> <path d=\"m3.34 7 1.73 1\"/> <circle cx=\"12\" cy=\"12\" r=\"2\"/> <circle cx=\"12\" cy=\"12\" r=\"8\"/>"),
    cam: svg("<path d=\"M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z\"/> <circle cx=\"12\" cy=\"13\" r=\"3\"/>"),
    heart: svg("<path d=\"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5\"/>"),
    cmp: svg("<circle cx=\"5\" cy=\"6\" r=\"3\"/> <path d=\"M12 6h5a2 2 0 0 1 2 2v7\"/> <path d=\"m15 9-3-3 3-3\"/> <circle cx=\"19\" cy=\"18\" r=\"3\"/> <path d=\"M12 18H7a2 2 0 0 1-2-2V9\"/> <path d=\"m9 15 3 3-3 3\"/>"),
    chev: svg("<path d=\"m9 18 6-6-6-6\"/>")
  };
  /* --- local "garage" (wishlist + compare), stored on device --- */
  const tenantScope = encodeURIComponent(config.tenantKey);
  const storageKey = kind => 'borz:garage:' + tenantScope + ':' + kind;
  const storedLists = {};
  const store = {
    get(kind) {
      if (!storedLists[kind]) {
        try {
          const list = JSON.parse(localStorage.getItem(storageKey(kind)));
          storedLists[kind] = Array.isArray(list) ? list.filter(id => typeof id === 'string') : [];
        } catch {
          storedLists[kind] = [];
        }
      }
      return storedLists[kind];
    },
    set(kind, list) {
      storedLists[kind] = list;
      try { localStorage.setItem(storageKey(kind), JSON.stringify(list)); } catch { /* Keep this tab usable without storage. */ }
      updateCounts();
    },
  };
  function toggle(key, id, max) {
    let list = store.get(key);
    if (list.includes(id)) list = list.filter(x => x !== id);
    else { if (max && list.length >= max) return false; list.push(id); }
    store.set(key, list); return true;
  }
  function updateCounts() {
    const w = store.get('wishlist').length, c = store.get('compare').length;
    $$('[data-wish-count]').forEach(el => { el.textContent = w; el.dataset.n = w; });
    $$('[data-cmp-count]').forEach(el => { el.textContent = c; el.dataset.n = c; });
    $$('[data-save-id]').forEach(b => b.setAttribute('aria-pressed', store.get('wishlist').includes(b.dataset.saveId)));
    $$('[data-cmp-id]').forEach(b => b.setAttribute('aria-pressed', store.get('compare').includes(b.dataset.cmpId)));
  }

  /* --- vehicle card --- */
  function card(v) {
    const name = html(title(v));
    const id = html(v.id);
    const facts = [
      [I.cal, v.year],
      [I.gauge, v.miles === null ? null : v.miles.toLocaleString('en-GB') + ' mi'],
      [I.fuel, v.fuel],
      [I.gear, v.gear],
    ].filter(([, value]) => value !== null && value !== '');
    return `<article class="vcard">
      <a class="cover" href="${html(vehicleHref(v))}" aria-label="View ${name}"></a>
      <div class="media4">${v.images.length ? `<img src="${html(v.images[0])}" alt="${name}" loading="lazy">` : '<span class="photos">No photos available</span>'}
        ${v.tag ? `<span class="tag">${html(v.tag)}</span>` : ''}${v.photos ? `<span class="photos">${I.cam}${v.photos}</span>` : ''}</div>
      <button class="cmp-btn" data-cmp-id="${id}" aria-pressed="false" aria-label="Compare">${I.cmp}</button>
      <button class="save-btn" data-save-id="${id}" aria-pressed="false" aria-label="Save">${I.heart}</button>
      <div class="body"><h3>${name}</h3><p class="deriv">${html(v.deriv)}</p>
        <ul class="vchips">${facts.map(([icon, value]) => `<li>${icon}<span>${html(value)}</span></li>`).join('')}</ul>
        <div class="divider"></div>
        <div class="price"><strong>${html(price(v))}</strong></div></div>
    </article>`;
  }
  window.SITE = { STOCK, gbp, card, store, toggle, updateCounts, I, html, price, title, vehicleHref, route, monthlyPayment };

  document.addEventListener('click', e => {
    const s = e.target.closest('[data-save-id]'), c = e.target.closest('[data-cmp-id]');
    if (s) { e.preventDefault(); toggle('wishlist', s.dataset.saveId); }
    if (c) { e.preventDefault(); if (!toggle('compare', c.dataset.cmpId, 3)) alert('You can compare up to 3 cars.'); }
  });

  /* --- header scroll state --- */
  const header = $('[data-header]');
  const onScroll = () => header && header.classList.toggle('scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* --- mobile drawer --- */
  const burger = $('[data-burger]'), drawer = $('[data-drawer]');
  burger && burger.addEventListener('click', () => {
    const open = !drawer.classList.contains('open');
    drawer.classList.toggle('open', open); burger.classList.toggle('open', open);
    document.body.classList.toggle('menu-open', open);
  });


  /* --- car-make logos: Simple Icons, same make→slug map as the original site; painted via CSS mask in currentColor --- */
  const MAKE_SLUG = {"alfa romeo":"alfaromeo",audi:"audi",bmw:"bmw",chevrolet:"chevrolet",citroen:"citroen",dacia:"dacia",fiat:"fiat",ford:"ford",honda:"honda",hyundai:"hyundai",jaguar:"jaguar",kia:"kia","land rover":"landrover",lexus:"lexus",mazda:"mazda",mercedes:"mercedes","mercedes-benz":"mercedes",mini:"mini",mitsubishi:"mitsubishi",nissan:"nissan",peugeot:"peugeot",porsche:"porsche",renault:"renault",seat:"seat",skoda:"skoda",suzuki:"suzuki",tesla:"tesla",toyota:"toyota",vauxhall:"vauxhall",volkswagen:"volkswagen",volvo:"volvo"};
  const NO_FILE = new Set(['lexus']); // not in Simple Icons (404 upstream)
  const makeLogo = m => { const key = String(m).toLowerCase(); const s = Object.hasOwn(MAKE_SLUG, key) ? MAKE_SLUG[key] : null; return s && !NO_FILE.has(s) ? `/borz-template/assets/img/makes/${s}.svg` : null; };
  const maskSpan = (cls, src) => `<span class="${cls}" aria-hidden="true" style="-webkit-mask-image:url(${src});mask-image:url(${src})"></span>`;
  window.makeLogo = makeLogo;
  const CAR_GLYPH = cls => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13.5l1.2-3.4A2 2 0 0 1 7.1 8.8h9.8a2 2 0 0 1 1.9 1.3L20 13.5"/><path d="M3.5 13.5h17v4a.8.8 0 0 1-.8.8H18a.8.8 0 0 1-.8-.8v-.7H6.8v.7a.8.8 0 0 1-.8.8H4.3a.8.8 0 0 1-.8-.8z"/><path d="M6.3 15.6h.01M17.7 15.6h.01"/></svg>`;

  /* --- home "shop by make" links (original .makes / .make-logo) --- */
  const mk = $('[data-makes]');
  if (mk) {
    const c = Object.create(null); STOCK.forEach(v => { if (v.make) c[v.make] = (c[v.make] || 0) + 1; });
    mk.innerHTML = Object.keys(c).sort().map(m => `<a href="${html(stockHref(m))}">${makeLogo(m) ? maskSpan('make-logo', makeLogo(m)) : CAR_GLYPH('make-logo make-logo--glyph')}${html(m)} <i>${c[m]}</i></a>`).join('');
  }

  /* --- mega menu (makes in stock) --- */
  const mega = $('[data-mega]');
  if (mega) {
    const makes = Object.create(null); STOCK.forEach(v => { if (v.make) makes[v.make] = (makes[v.make] || 0) + 1; });
    $('[data-mega-grid]').innerHTML = Object.keys(makes).sort().map(m =>
      `<a class="mega-item" href="${html(stockHref(m))}">${makeLogo(m) ? maskSpan('mega-logo', makeLogo(m)) : CAR_GLYPH('mega-logo mega-logo--glyph')}<span class="mega-label">${html(m)}</span><small>${makes[m]}</small><svg class="mega-item-chev" width="7" height="12" viewBox="0 0 8 14" aria-hidden="true"><path d="M1.5 1 6.5 7l-5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></a>`).join('');
    $('[data-mega-note]').textContent = `${STOCK.length} cars in stock across ${Object.keys(makes).length} makes`;
    let t; const open = () => { clearTimeout(t); mega.classList.add('is-open'); }, close = () => { t = setTimeout(() => mega.classList.remove('is-open'), 120); };
    mega.addEventListener('mouseenter', open); mega.addEventListener('mouseleave', close);
    mega.addEventListener('focusin', open); mega.addEventListener('focusout', close);
  }

  /* --- stock-derived counters + make dropdowns --- */
  const makeList = [...new Set(STOCK.map(v => v.make).filter(Boolean))].sort();
  $$('[data-stock-count]').forEach(el => {
    if (stockUnavailable) {
      const presentation = el.closest('li') || el;
      presentation.textContent = 'Stock temporarily unavailable';
    } else {
      el.textContent = STOCK.length;
    }
  });
  $$('[data-make-count]').forEach(el => el.textContent = makeList.length);
  $$('[data-make-options]').forEach(sel => makeList.forEach(m => sel.insertAdjacentHTML('beforeend', `<option>${html(m)}</option>`)));
  const latest = $('[data-latest-grid]');
  if (latest) { if (STOCK.length) latest.innerHTML = STOCK.slice(0, 4).map(card).join(''); else $('[data-latest]').hidden = true; }

  const readStorage = (storage, key) => { try { return storage.getItem(key); } catch { return null; } };
  const writeStorage = (storage, key, value) => { try { storage.setItem(key, value); } catch { /* Optional preference. */ } };
  /* --- cookie banner --- */
  const cookieKey = 'borz:cookie:' + tenantScope;
  const cookie = $('[data-cookie]');
  if (cookie && !readStorage(localStorage, cookieKey)) cookie.hidden = false;
  $$('[data-cookie-accept],[data-cookie-essential]').forEach(b => b.addEventListener('click', () => {
    writeStorage(localStorage, cookieKey, b.hasAttribute('data-cookie-accept') ? 'all' : 'essential'); cookie.hidden = true;
  }));

  /* --- WhatsApp teaser --- */
  const waKey = 'borz:wa-closed:' + tenantScope;
  const wa = $('[data-wa-card]');
  if (wa && readStorage(sessionStorage, waKey)) wa.hidden = true;
  $('[data-wa-close]')?.addEventListener('click', () => { wa.hidden = true; writeStorage(sessionStorage, waKey, '1'); });

  /* --- reveal on scroll --- */
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' }) : null;
  $$('.rv').forEach(el => io ? io.observe(el) : el.classList.add('in'));

  updateCounts();
});

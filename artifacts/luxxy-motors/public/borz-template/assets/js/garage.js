/* Wishlist + compare pages, reading the device-local lists written by main.js. */
window.BORZ_READY.then(function () {
  const { STOCK, card, store, price, html, title, vehicleHref, route, updateCounts } = window.SITE;
  const byId = id => STOCK.find(v => v.id === id);
  function wish() {
    const grid = document.querySelector('[data-wish-grid]'); if (!grid) return;
    const list = store.get('wishlist').map(byId).filter(Boolean);
    grid.innerHTML = list.map(card).join(''); document.querySelector('[data-wish-empty]').hidden = list.length > 0;
  }
  function compare() {
    const slots = document.querySelectorAll('[data-slot]'); if (!slots.length) return;
    const list = store.get('compare').map(byId).filter(Boolean);
    slots.forEach((s, i) => {
      const v = list[i];
      s.className = 'slot' + (v ? ' filled' : '');
      s.innerHTML = v ? `<small>0${i + 1}</small><button class="rm" data-cmp-id="${html(v.id)}" aria-label="Remove">✕</button>${v.images.length ? `<img src="${html(v.images[0])}" alt="${html(title(v))}">` : ''}<b>${html(title(v))}</b><span>${html(v.deriv)}</span>
        <dl>${[
          ['Price', price(v)], ['Year', v.year], ['Mileage', v.miles === null ? null : v.miles.toLocaleString('en-GB') + ' miles'],
          ['Fuel', v.fuel], ['Gearbox', v.gear], ['Body', v.body],
        ].filter(([, value]) => value !== null && value !== '').map(([label, value]) => `<div><dt>${label}</dt><dd>${html(value)}</dd></div>`).join('')}</dl>
        <a class="text-link" href="${html(vehicleHref(v))}" style="margin-top:12px">View car</a>`

        : `<small>0${i + 1}</small><span class="plus">+</span><b>Choose a vehicle</b><a href="${html(route('/stock'))}"><span>Browse current stock</span></a>`;
    });
  }
  const render = () => { wish(); compare(); updateCounts(); };
  document.addEventListener('click', e => { if (e.target.closest('[data-save-id],[data-cmp-id]')) setTimeout(render, 0); });
  render();
});

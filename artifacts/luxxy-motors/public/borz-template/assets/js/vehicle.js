/* Vehicle detail using the selected dealership’s public vehicle endpoint. */
window.BORZ_READY.then(function ({ vehicle, settings, publicFeatures }) {
  const { STOCK, card, price, html, title, route, I, updateCounts, gbp, monthlyPayment, keepTabInside } = window.SITE;
  const $ = (selector) => document.querySelector(selector);
  if (!vehicle) {
    const main = $('main') || $('[data-gallery]')?.closest('section');
    if (main) main.innerHTML = `<section class="sec white"><div class="shell"><h1>Vehicle unavailable</h1><a class="btn" href="${html(route('/stock'))}">Browse current stock</a></div></section>`;
    return;
  }

  const v = vehicle;
  const name = title(v);
  const data = key => document.querySelector(`[data-v="${key}"]`);
  const set = (key, value) => {
    const element = data(key);
    if (element) element.textContent = value ?? '';
  };
  const setMarkup = (key, markup) => {
    const element = data(key);
    if (element) element.innerHTML = markup;
  };
  const mileage = v.miles === null ? '' : v.miles.toLocaleString('en-GB') + ' miles';
  document.title = `${name} | ${document.title.split('|').pop().trim()}`;
  set('crumb', name);
  set('kicker', [v.year, v.body].filter(Boolean).join(' · '));
  set('title', name);
  set('deriv', v.deriv);
  set('price', price(v));
  data('monthly')?.closest('span')?.remove();
  if (v.price > 0 && v.currency === 'GBP' && !/poa|price on application|no price/i.test(v.priceType)) {
    set('price2', price(v));
    set('dep', gbp(v.price / 10));
    set('monthly2', gbp(monthlyPayment(v.price - v.price / 10, 48, 12.9)));
  } else {
    $('.mini-calc')?.remove();
  }

  const facts = [[I.cal, v.year], [I.gauge, mileage], [I.fuel, v.fuel], [I.gear, v.gear]];
  setMarkup('quick', facts.filter(([, value]) => value !== null && value !== '').map(([icon, value]) => `<li>${icon}${html(value)}</li>`).join(''));
  const specs = {
    Year: v.year, Registration: v.registration, Mileage: mileage, Fuel: v.fuel, Gearbox: v.gear,
    'Body type': v.body, Engine: v.engine, Colour: v.colour, Doors: v.doors, Seats: v.seats,
    Owners: v.owners, 'Write-off category': v.writeOffCategory,
  };
  setMarkup('specs', Object.entries(specs).filter(([, value]) => value !== null && value !== '').map(([key, value]) => `<div><dt>${html(key)}</dt><dd>${html(value)}</dd></div>`).join(''));
  if (v.description) {
    setMarkup('desc', v.description.split(/\n+/).filter(Boolean).map(paragraph => `<p>${html(paragraph)}</p>`).join(''));
  } else {
    data('desc')?.closest('.vd-block')?.remove();
  }
  if (v.features.length) {
    setMarkup('features', v.features.map(feature => `<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>${html(feature)}</li>`).join(''));
  } else {
    data('features')?.closest('.vd-block')?.remove();
  }

  const save = $('[data-save]');
  const compare = $('[data-compare]');
  if (save) save.dataset.saveId = v.id;
  if (compare) compare.dataset.cmpId = v.id;
  const readOnly = window.BORZ_CONFIG.readOnly;
  const features = publicFeatures?.features || {};
  const canEnquire = readOnly || features.publicEnquiries === true;
  const canExchange = canEnquire && (readOnly || features.partExchange === true) && settings?.partExchange?.enabled !== false;
  const enquiryHref = type => route((readOnly ? '/contact?' : '/enquire?') + new URLSearchParams({ type, vehicleId: v.id }).toString());
  document.querySelectorAll('.vd-panel [data-borz-enquiry]').forEach(anchor => {
    const type = anchor.dataset.borzEnquiry;
    if (type === 'viewing' && (settings?.testDriveBooking?.enabled === false || !canEnquire)) {
      anchor.remove();
    } else {
      anchor.href = canEnquire ? enquiryHref(type) : route('/contact');
    }
  });
  const plateForm = $('.vd-body form.plate-form');
  if (plateForm) {
    if (settings?.partExchange?.enabled === false) {
      plateForm.closest('.vd-block')?.remove();
    } else {
      plateForm.addEventListener('submit', event => {
        event.preventDefault();
        if (!canExchange) {
          location.assign(route('/sell-your-car'));
          return;
        }
        const registration = (plateForm.querySelector('input')?.value || '').replace(/\s+/g, '').toUpperCase();
        if (/^[A-Z0-9]{3,9}$/.test(registration) && !readOnly) {
          const details = {
            registration, makeModel: '', mileage: '', condition: '', conditionNotes: '', keys: '',
            v5: '', serviceHistory: '', name: '', phone: '', email: '',
          };
          try {
            sessionStorage.setItem('luxxy.part-exchange-draft:' + v.id, JSON.stringify({
              savedAt: Date.now(), data: { details, vehicleId: v.id, delivery: 'website' },
            }));
          } catch { /* The native form can ask for the registration again. */ }
        }
        location.assign(enquiryHref('part_exchange'));
      });
    }
  }

  const main = $('[data-g-main]');
  const count = $('[data-g-count]');
  const thumbs = $('[data-thumbs]');
  const fullscreen = $('[data-g-full]');
  const previous = $('[data-g-prev]');
  const next = $('[data-g-next]');
  const lightbox = $('[data-lightbox]');
  const lightboxImage = $('[data-lb-img]');
  const lightboxPrevious = $('[data-lb-prev]');
  const lightboxNext = $('[data-lb-next]');
  const imgs = v.images;
  if (!imgs.length) {
    const notice = document.createElement('small');
    notice.className = 'g-count';
    notice.textContent = 'No photos available';
    main.replaceWith(notice);
    for (const element of [count, previous, next, fullscreen, thumbs]) element.remove();
  } else {
    let current = 0;
    thumbs.innerHTML = imgs.map((src, index) => `<button data-i="${index}" aria-label="Photo ${index + 1}"><img src="${html(src)}" alt="" loading="lazy"></button>`).join('');
    thumbs.setAttribute('role', 'group');
    thumbs.setAttribute('aria-label', 'Vehicle photo thumbnails');
    const photoButtons = [...thumbs.children];
    const close = $('[data-lb-close]');
    const lightboxControls = imgs.length > 1 ? [close, lightboxPrevious, lightboxNext] : [close];
    lightbox.id = 'borz-vehicle-photos';
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-label', 'Vehicle photos');
    fullscreen.setAttribute('aria-controls', lightbox.id);
    fullscreen.setAttribute('aria-haspopup', 'dialog');
    close.setAttribute('aria-label', 'Close photo gallery');
    lightboxPrevious.setAttribute('aria-label', 'Previous photo');
    lightboxNext.setAttribute('aria-label', 'Next photo');
    function show(index) {
      current = (index + imgs.length) % imgs.length;
      main.src = imgs[current];
      main.alt = `${name}, photo ${current + 1}`;
      count.textContent = `${current + 1} / ${imgs.length}`;
      photoButtons.forEach((button, position) => {
        button.classList.toggle('is-active', position === current);
        button.setAttribute('aria-pressed', String(position === current));
        button.tabIndex = position === current ? 0 : -1;
      });
      if (thumbs.clientWidth < thumbs.scrollWidth) {
        const strip = thumbs.getBoundingClientRect();
        const selected = photoButtons[current].getBoundingClientRect();
        if (selected.left < strip.left) thumbs.scrollLeft += selected.left - strip.left;
        if (selected.right > strip.right) thumbs.scrollLeft += selected.right - strip.right;
      }
      if (lightbox.classList.contains('open')) {
        lightboxImage.src = imgs[current];
        lightboxImage.alt = main.alt;
      }
    }
    thumbs.addEventListener('click', event => {
      const button = event.target.closest('[data-i]');
      if (button) show(Number(button.dataset.i));
    });
    thumbs.addEventListener('keydown', event => {
      const positions = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: imgs.length - 1 };
      if (!Object.hasOwn(positions, event.key)) return;
      event.preventDefault();
      show(positions[event.key]);
      photoButtons[current].focus({ preventScroll: true });
    });
    const closeLightbox = () => {
      lightbox.classList.remove('open');
      document.body.classList.remove('borz-modal-open');
      fullscreen.focus({ preventScroll: true });
    };
    fullscreen.onclick = () => {
      lightbox.classList.add('open');
      document.body.classList.add('borz-modal-open');
      show(current);
      close.focus({ preventScroll: true });
    };
    close.onclick = closeLightbox;
    if (imgs.length > 1) {
      previous.onclick = lightboxPrevious.onclick = () => show(current - 1);
      next.onclick = lightboxNext.onclick = () => show(current + 1);
      let startX = null;
      main.addEventListener('touchstart', event => { startX = event.touches[0].clientX; }, { passive: true });
      main.addEventListener('touchend', event => {
        if (startX === null) return;
        const difference = event.changedTouches[0].clientX - startX;
        if (Math.abs(difference) > 40) show(current + (difference < 0 ? 1 : -1));
        startX = null;
      });
    } else {
      for (const element of [previous, next, lightboxPrevious, lightboxNext, thumbs]) element.remove();
    }
    document.addEventListener('keydown', event => {
      if (!lightbox.classList.contains('open') || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeLightbox();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        show(current + (event.key === 'ArrowLeft' ? -1 : 1));
      } else {
        keepTabInside(event, lightboxControls);
      }
    });
    show(0);
  }

  const remaining = STOCK.filter(car => car.id !== v.id);
  const similar = remaining.filter(car => (v.body && car.body === v.body) || (v.make && car.make === v.make));
  const recommendations = [...new Set([...similar, ...remaining])].slice(0, 4);
  const similarGrid = $('[data-similar]');
  similarGrid.innerHTML = recommendations.map(card).join('');
  if (!recommendations.length) similarGrid.closest('section').hidden = true;
  $('[data-borz-vehicle-body]').hidden = false;
  updateCounts();
});

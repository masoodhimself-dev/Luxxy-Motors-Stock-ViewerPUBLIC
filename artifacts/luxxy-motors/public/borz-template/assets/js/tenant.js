/* Bind the template to its own tenant and reuse DealerOS's public enquiry route. */
(() => {
  const config = window.BORZ_CONFIG;
  const all = selector => document.querySelectorAll(selector);
  const plain = value => typeof value === 'string' ? value.trim() : '';
  const base = typeof config?.basePath === 'string' ? config.basePath.replace(/\/$/, '') : '';
  const route = pathname => base + pathname;
  const cleanNumber = value => plain(value).replace(/[^\d+]/g, '');
  const formatNumber = value => value.replace(/^(020)(\d{4})(\d{4})$/, '$1 $2 $3');
  const secureUrl = value => {
    if (!plain(value)) return '';
    try {
      const url = new URL(value, location.origin);
      return (url.protocol === 'https:' || url.origin === location.origin) && !url.username && !url.password ? url.href : '';
    } catch {
      return '';
    }
  };
  const localAsset = value => {
    const resolved = secureUrl(value);
    if (!resolved || !base) return resolved;
    const asset = new URL(resolved);
    return [location.origin, config.canonicalOrigin].includes(asset.origin) &&
      /^\/api\/(?:website-assets\/[a-f0-9-]{36}|demo-logo)$/i.test(asset.pathname)
      ? route(asset.pathname) + asset.search
      : resolved;
  };

  function bindTenant(settings) {
    const identity = settings.identity ?? {};
    const contact = settings.contact ?? {};
    const address = settings.address ?? {};
    const social = settings.social ?? {};
    const hours = Array.isArray(settings.hours) ? settings.hours
      .map(row => [plain(row?.days), plain(row?.times)])
      .filter(([days, times]) => days && times) : [];
    const dayHours = new Map(hours);
    const values = {
      brand: plain(identity.name) || 'Car dealership',
      tagline: plain(address.city) ? 'Independent used car dealership in ' + plain(address.city) + '.' : 'Independent used car dealership.',
      phone: formatNumber(cleanNumber(contact.phone)),
      email: plain(contact.email),
      street: plain(address.street),
      city: plain(address.city),
      region: plain(address.region),
      postcode: plain(address.postcode),
      weekday: dayHours.get('Monday') || 'Ask the team',
      sunday: dayHours.get('Sunday') || 'Ask the team',
    };
    const mapQuery = [values.street, values.city, values.postcode].filter(Boolean).join(', ');
    const whatsapp = cleanNumber(contact.whatsapp).replace(/^\+/, '');
    const phone = cleanNumber(contact.phone);
    const hrefs = {
      phone: /^\+?\d{7,15}$/.test(phone) ? 'tel:' + phone : '',
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email) ? 'mailto:' + encodeURI(values.email) : '',
      whatsapp: /^\d{8,15}$/.test(whatsapp) ? 'https://wa.me/' + whatsapp : '',
      maps: secureUrl(address.mapsUrl) || (mapQuery ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(mapQuery) : ''),
      facebook: secureUrl(social.facebook),
      instagram: secureUrl(social.instagram),
      privacy: secureUrl(settings.legal?.privacyUrl),
    };
    if (config.readOnly) {
      for (const key of ['phone', 'email', 'whatsapp']) if (hrefs[key]) hrefs[key] = route('/contact');
    }
    for (const element of all('[data-borz-text]')) {
      const value = values[element.dataset.borzText];
      if (typeof value === 'string') element.textContent = value;
    }
    for (const element of all('[data-borz-aria-label]')) {
      element.setAttribute('aria-label', element.dataset.borzAriaLabel.replace(/\[\[([a-z]+)\]\]/g, (_, key) => values[key] || ''));
    }
    for (const anchor of all('[data-borz-href]')) {
      const href = hrefs[anchor.dataset.borzHref];
      if (!href) continue;
      anchor.href = href;
      anchor.hidden = false;
    }
    for (const area of all('[data-borz-location]')) area.hidden = !values.city;
    if (hrefs.whatsapp) for (const dock of all('[data-borz-whatsapp-dock]')) dock.hidden = false;
    // Match the shared storefront's verified Multi Choice brand on Borz's dark surfaces.
    const multiChoice = ['https://multichoicemotors.co.uk', 'https://www.multichoicemotors.co.uk'].includes(config.canonicalOrigin);
    const multiChoiceWordmark = '/brand/multi-choice-motors/multi-choice-wordmark-white.svg';
    const logo = multiChoice ? multiChoiceWordmark : localAsset(identity.logoAsset);
    const footer = multiChoice ? multiChoiceWordmark : localAsset(settings.presentation?.footerLogoUrl);
    for (const image of all('[data-borz-logo]')) {
      const source = multiChoice && image.closest('.wa-card')
        ? '/brand/multi-choice-motors/multi-choice-wordmark.svg'
        : image.closest('.f-logo') ? footer || logo : logo || footer;
      if (!source) continue;
      const fallback = image.parentElement?.querySelector('[data-borz-logo-fallback]');
      image.addEventListener('load', () => {
        image.alt = values.brand;
        image.hidden = false;
        if (fallback) fallback.hidden = true;
      }, { once: true });
      image.src = source;
    }
    const title = document.title.replace(/\s*\| Car dealership$/, '');
    document.title = title + ' | ' + values.brand;
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const commonHours = dayHours.get('Monday');
    const uniform = commonHours && days.every(day => dayHours.get(day) === commonHours);
    const displayedHours = uniform ? [['Monday–Saturday', commonHours], ...hours.filter(([day]) => !days.includes(day))] : hours;
    for (const list of all('[data-borz-hours]')) {
      if (!displayedHours.length) continue;
      list.replaceChildren(...displayedHours.map(([day, time]) => {
        const row = document.createElement('div');
        const term = document.createElement('dt');
        const description = document.createElement('dd');
        term.textContent = day;
        description.textContent = time;
        row.append(term, description);
        return row;
      }));
    }
    for (const summary of all('[data-borz-hours-summary]')) {
      summary.textContent = uniform && dayHours.has('Sunday')
        ? 'Mon–Sat ' + commonHours + ' · Sun ' + dayHours.get('Sunday')
        : 'See opening hours on the contact page';
    }
    for (const count of all('[data-borz-days-open]')) {
      count.textContent = hours.length === 7 ? String(hours.filter(([, time]) => !/closed|by appointment/i.test(time)).length) : '–';
    }
  }

  const status = document.querySelector('[data-borz-status]');
  const forms = [...all('[data-borz-contact]')];
  const previewMessage = 'This is a read-only preview. No enquiry has been sent.';
  for (const form of forms) form.addEventListener('submit', event => event.preventDefault(), true);

  if (!config || !window.BORZ_READY) {
    if (status) { status.textContent = 'Local template preview. Dealer contact and enquiries are disabled.'; status.hidden = false; }
    return;
  }

  window.BORZ_READY.then(({ settings, publicFeatures, stock }) => {
    if (settings) bindTenant(settings);
    if (config.readOnly) {
      const query = new URLSearchParams(location.search);
      const selected = stock.find(car => car.id === query.get('vehicleId'));
      const label = selected && (selected.title || [selected.make, selected.model].filter(Boolean).join(' '));
      const form = forms.find(item => item.dataset.borzContact === 'general');
      const note = form?.querySelector('[name="message"]');
      if (label && note) {
        const purposes = new Map([['viewing', 'Test drive'], ['part_exchange', 'Part exchange']]);
        const heading = purposes.get(query.get('type')) || 'Vehicle enquiry';
        const selectedLabel = document.createElement('p');
        selectedLabel.className = 'borz-selected-vehicle';
        selectedLabel.textContent = heading + ' for ' + label;
        form.querySelector('.cform-body')?.prepend(selectedLabel);
        note.value = heading + ': ' + label;
      }
      const enquiryPath = route('/enquire');
      for (const link of all(`a[href^="${enquiryPath}?"]`)) {
        link.href = route('/contact') + new URL(link.href).search;
      }
    }
    const bodyTypes = new Set((stock || []).map(car => car.body).filter(Boolean));
    for (const count of all('[data-borz-body-count]')) count.textContent = String(bodyTypes.size);
    const features = publicFeatures?.features || {};
    for (const form of forms) {
      const mode = form.dataset.borzContact;
      const button = form.querySelector('button[type="submit"]');
      if (!button) continue;
      const message = document.createElement('p');
      message.className = 'borz-form-status';
      message.setAttribute('role', 'status');
      message.hidden = true;
      button.after(message);
      const showMessage = value => { message.textContent = value; message.hidden = false; };
      const canSubmit = features.publicEnquiries === true && (mode !== 'part_exchange' || features.partExchange === true && settings?.partExchange?.enabled === true);
      if (config.readOnly) showMessage(previewMessage);
      else if (!canSubmit) showMessage('Online enquiries are currently unavailable. Please contact the showroom.');
      button.disabled = config.readOnly !== true && !canSubmit;

      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (config.readOnly) return showMessage(previewMessage);
        if (!canSubmit || button.disabled || !form.reportValidity()) return;
        const data = new FormData(form);
        const value = name => plain(data.get(name));
        if (mode === 'sourcing') {
          const brief = ['Vehicle sourcing', value('car'), value('budget'), value('specification')].filter(Boolean).join(' · ');
          location.assign(route('/enquire') + '?' + new URLSearchParams({ type: 'general', searchRequest: brief }));
          return;
        }

        const customerName = value('customerName');
        const phone = value('phone');
        const email = value('email');
        const preferredContact = mode === 'part_exchange' ? 'phone' : value('preferredContact').toLowerCase() || 'email';
        if (customerName.length < 2 || preferredContact === 'email' && !email || preferredContact !== 'email' && !phone) {
          return showMessage('Enter your name and the contact details for your preferred contact method.');
        }
        const body = { type: 'general', vehicleId: null, customerName, phone: phone || null, email: email || null, preferredContact, message: value('message') };
        if (mode === 'part_exchange') {
          const registration = value('registration').toUpperCase().replace(/\s/g, '');
          const mileageText = value('mileage').replaceAll(',', '');
          const mileage = Number(mileageText);
          if (!/^[A-Z0-9]{2,8}$/.test(registration) || !/^\d{1,7}$/.test(mileageText) || mileage > 1000000) {
            return showMessage('Enter a registration and a mileage in whole miles.');
          }
          body.type = 'part_exchange';
          body.message = 'Please contact me about a valuation for ' + registration + '.';
          body.partExchange = { registration, mileage };
        } else if (value('topic') && value('topic') !== 'General enquiry') {
          body.message = value('topic') + '\n\n' + body.message;
        }
        button.disabled = true;
        showMessage('Sending your enquiry…');
        try {
          const response = await fetch(route('/api/enquiries'), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000),
          });
          const result = await response.json().catch(() => null);
          if (!response.ok) throw new Error(plain(result?.error?.message) || plain(result?.error) || plain(result?.message));
          form.reset();
          showMessage('Your enquiry has been sent to the dealership.');
        } catch (error) {
          showMessage(error instanceof Error && error.message ? error.message : 'We couldn’t send your enquiry. Please try again or contact the showroom.');
          button.disabled = false;
        }
      });
    }
  });
})();

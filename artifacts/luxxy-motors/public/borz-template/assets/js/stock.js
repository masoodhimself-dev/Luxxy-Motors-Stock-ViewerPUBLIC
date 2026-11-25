/* Resolve the selected dealership's public data before the catalogue renders. */
(() => {
  const config = window.BORZ_CONFIG || {};
  const text = value => typeof value === 'string' ? value.trim() : '';
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const hiddenStatuses = new Set(['sold', 'hidden', 'archived', 'deleted', 'removed', 'unavailable', 'inactive', 'withdrawn']);
  const safePhoto = value => {
    const candidate = text(typeof value === 'string' ? value : value?.url);
    if (!candidate) return null;
    try {
      const url = new URL(candidate, config.canonicalOrigin || window.location.origin);
      const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === window.location.origin);
      return allowed && !url.username && !url.password ? url.href : null;
    } catch {
      return null;
    }
  };

  function toCar(car) {
    if (!car || typeof car !== 'object' || !text(car.id)) return null;
    const status = text(car.inventoryStatus).toLowerCase();
    if (hiddenStatuses.has(status)) return null;
    const extras = car.sourceExtras || {};
    const specs = car.specifications || {};
    const features = [extras.features, extras.equipment, specs.features, specs.equipment]
      .filter(Array.isArray).flat().map(text).filter(Boolean);
    const images = [...new Set([car.heroImage, ...(Array.isArray(car.images) ? car.images : [])].map(safePhoto).filter(Boolean))];
    const registration = text(car.registration || car.plate || car.vrm).toUpperCase();
    return {
      id: text(car.id),
      make: text(car.make),
      model: text(car.model),
      title: text(car.title),
      deriv: text(car.variant || car.trim),
      year: number(car.year),
      miles: number(car.mileage),
      fuel: text(car.fuel),
      gear: text(car.transmission),
      body: text(car.bodyType),
      price: number(car.price),
      priceType: text(car.priceType),
      currency: text(car.currency) || 'GBP',
      images,
      photos: images.length,
      tag: status === 'reserved' ? 'Reserved' : '',
      colour: text(car.colour),
      engine: text(car.engineSize),
      doors: number(car.doors),
      seats: number(car.seats),
      owners: number(car.owners),
      registration: /^[A-Z0-9 ]{3,10}$/.test(registration) ? registration : '',
      writeOffCategory: text(car.writeOffCategory),
      description: text(car.description || specs.description || extras.description || extras.advertDescription || extras.dealerDescription),
      features: [...new Set(features)],
      listedAt: text(car.listedAt),
      publicCode: /^[a-z0-9]{8}$/.test(extras.publicVehicleCode) ? extras.publicVehicleCode : '',
    };
  }

  async function get(endpoint) {
    if (!endpoint) return null;
    try {
      const url = new URL(endpoint, window.location.origin);
      if (url.origin !== window.location.origin) return null;
      const response = await fetch(url, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }

  window.BORZ_READY = Promise.all([
    get(config.stockUrl), get(config.settingsUrl), get(config.vehicleUrl), get(config.featuresUrl),
  ]).then(([payload, settings, single, publicFeatures]) => {
    const raw = Array.isArray(payload?.cars) ? payload.cars : [];
    const stock = [...new Map(raw.map(toCar).filter(Boolean).map(car => [car.id, car])).values()];
    const vehicle = config.vehicleUrl
      ? toCar(single?.vehicle || single)
      : config.vehicleId ? stock.find(car => car.id === config.vehicleId) ?? null : null;
    window.STOCK = stock;
    return { stock, settings, vehicle, publicFeatures, stockUnavailable: !Array.isArray(payload?.cars) };
  });
})();

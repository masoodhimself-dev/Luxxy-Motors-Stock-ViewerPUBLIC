import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const autoFixture = JSON.parse(readFileSync(resolve('src/lib/__fixtures__/vehicle-sheet-autotrader.json'), 'utf8'));
const cazooFixture = JSON.parse(readFileSync(resolve('src/lib/__fixtures__/vehicle-sheet-cazoo.json'), 'utf8'));

// Every API response is a fixture and every mutation is blocked. No provider is contacted.
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Isolated local public-sheet verification only.');
const output = resolve('../../../vehicle-sheet-public-2026-10-31');
const now = '2026-10-31T12:00:00.000Z';
const scratch = 'A known scratch on the rear door is disclosed.';
type Source = 'autotrader' | 'cazoo';
type StockMode = 'current' | 'price' | 'sold' | 'removed' | 'failed' | 'malformed';
type MotMode = 'current' | 'first-due' | 'uncached' | 'old' | 'failed';
type FixtureState = { mode: StockMode; mot: MotMode; stockReads: number; vehicleReads: number; motReads: string[]; imageProxyReads: string[]; writes: string[]; errors: string[]; networkIssues: string[]; consoleErrors: string[]; car: Record<string, any>; canonical: string };

async function fixture(page: Page, source: Source, remotePhotos = false): Promise<FixtureState> {
  const localOrigin = new URL(test.info().project.use.baseURL as string).origin;
  const original = structuredClone(source === 'autotrader' ? autoFixture : cazooFixture) as Record<string, any>;
  const plate = source === 'autotrader' ? 'AB15 CDE' : 'CD68 EFG';
  const description = `${'A comfortable, well equipped vehicle with a documented specification. '.repeat(17)}${scratch}`;
  const photoOrigin = remotePhotos ? 'https://images.sheet-fixture.invalid' : '';
  const photoUrls = [`${photoOrigin}/sheet-fixture/car.jpg`, `${photoOrigin}/sheet-fixture/second.jpg`];
  const car = { ...original, plate, vrm: plate.replace(/ /g, ''), vrmVerified: true, inventoryStatus: 'available', writeOffCategory: 'N',
    heroImage: photoUrls[0], images: [{ url: photoUrls[0], caption: 'Front view' }, { url: photoUrls[1], caption: 'Supporting view' }],
    sourceExtras: { ...original.sourceExtras, description, advertDescription: description, originalAdvertDescriptions: [description], descriptionOrigin: 'source' },
  };
  const canonical = source === 'autotrader' ? 'https://luxxymotors.uk' : 'https://multichoicemotors.co.uk';
  const state: FixtureState = { mode: 'current', mot: 'current', stockReads: 0, vehicleReads: 0, motReads: [], imageProxyReads: [], writes: [], errors: [], networkIssues: [], consoleErrors: [], car, canonical };
  const settings = await (await page.request.get('/api/dealer-settings')).json();
  const dealer = source === 'autotrader' ? 'Luxxy Motors' : 'Multi-Choice Motors';
  const publicSettings = { ...settings, identity: { ...settings.identity, name: dealer, logoText: dealer, logoAsset: '', brandColors: { primaryHsl: source === 'autotrader' ? '205 55% 35%' : '39 70% 35%' } },
    contact: { phone: '02079460123', whatsapp: '+447700900123', email: 'sales@fixture-motors.co.uk' },
    address: { street: '36A Coldharbour Lane', city: 'Hayes', region: 'London', postcode: 'UB3 3EP' },
    hours: [{ days: 'Mon-Sat', times: '10:00-18:00' }, { days: 'Sunday', times: '10:00-17:00' }],
    legal: { ...settings.legal, companyName: `${dealer} Limited`, companyNumber: '12345678', vatNumber: '' }, brochure: { useWebsiteColour: true, footerNote: 'Please confirm availability before travelling.' } };
  const photo = await readFile(resolve('src/assets/demo-car-hero.jpg'));
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') state.consoleErrors.push(message.text()); });
  page.on('requestfailed', request => state.networkIssues.push(`${request.url()} ${request.failure()?.errorText}`));
  page.on('response', response => { if (response.status() >= 400) state.networkIssues.push(`${response.status()} ${response.url()}`); });
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(origin => {
    const setCanonical = () => {
      let tag = document.querySelector<HTMLMetaElement>('meta[name="luxxy-canonical-origin"][data-page-meta]');
      if (!tag) { tag = document.createElement('meta'); tag.name = 'luxxy-canonical-origin'; tag.dataset.pageMeta = '1'; document.head.appendChild(tag); }
      tag.content = origin;
    };
    document.addEventListener('DOMContentLoaded', setCanonical, { once: true });
    (window as any).__sheetPrints = 0;
  }, canonical);
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    // A CORS-less remote gallery is simulated entirely in the browser route.
    // This exercises the tenant-bound image proxy without contacting a host.
    if (remotePhotos && photoUrls.includes(url.href)) return route.fulfill({ body: photo, contentType: 'image/jpeg' });
    if (url.origin !== localOrigin) return route.abort();
    if (url.pathname.startsWith('/sheet-fixture/')) return route.fulfill({ body: photo, contentType: 'image/jpeg' });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (!['GET', 'HEAD'].includes(request.method())) {
      state.writes.push(url.pathname);
      return route.fulfill({ status: 403, json: { error: 'Public-sheet tests block every write.' } });
    }
    if (url.pathname === '/api/dealer-settings') return route.fulfill({ json: publicSettings });
    if (url.pathname === `/api/vehicles/${car.id}/sheet-image`) {
      const source = url.searchParams.get('source') || '';
      state.imageProxyReads.push(source);
      expect(photoUrls).toContain(source);
      return route.fulfill({ body: photo, contentType: 'image/jpeg' });
    }
    if (url.pathname === '/api/stock') {
      state.stockReads++;
      return route.fulfill({ json: { schemaVersion: 1, dealerName: dealer, count: 1, scrapedAt: now, cars: [car] }, headers: { ETag: '"initial-stock"' } });
    }
    if (url.pathname === `/api/vehicles/${car.id}`) {
      state.vehicleReads++;
      if (state.mode === 'failed') return route.fulfill({ status: 503, json: { error: 'Fixture stock check unavailable.' } });
      if (state.mode === 'malformed') return route.fulfill({ json: { id: 'wrong-car', title: car.title } });
      if (state.mode === 'removed') return route.fulfill({ status: 404, json: { error: 'Vehicle no longer listed.' } });
      const latest = state.mode === 'price' ? { ...car, price: 8750, features: ['Panoramic roof from the latest feed'], description: 'Freshly supplied vehicle description from the latest feed.' } : state.mode === 'sold' ? { ...car, inventoryStatus: 'sold' } : car;
      return route.fulfill({ json: latest });
    }
    if (url.pathname.includes('/mot-history')) {
      state.motReads.push(url.search);
      if (state.mot === 'failed') return route.fulfill({ status: 503, json: { code: 'unavailable' } });
      if (state.mot === 'uncached') return route.fulfill({ json: { status: 'uncached' } });
      const history = { registration: plate.replace(/ /g, ''), make: car.make, model: car.model, checkedAt: state.mot === 'old' ? '2026-10-20T12:00:00Z' : now, recall: 'Unknown',
        ...(state.mot === 'first-due' ? { firstMotDueDate: '2028-05-20', tests: [] } : { tests: [{ completedDate: '2026-10-10T10:00:00Z', result: 'PASSED', expiryDate: '2027-10-09', mileage: '42000', mileageUnit: 'MI', defects: [] }] }) };
      return route.fulfill({ json: { status: 'available', history } });
    }
    // Public feature gates are fixture-only; unrelated reads cannot contact a provider.
    if (/features$/.test(url.pathname)) return route.fulfill({ json: { enabled: true, features: {} } });
    return route.fulfill({ status: 404, json: { error: 'No fixture for this read.' } });
  });
  if (process.env.LUXXY_SHEET_DIAGNOSTICS === '1') await page.route('**/src/lib/vehicle-sheet/controller.tsx*', async route => {
    const response = await route.fetch(), body = await response.text();
    const capture = 'globalThis.__lastSheetFit = { ...JSON.parse(JSON.stringify(result)), nodes: [...host.querySelectorAll("[data-lvs-text], .lvs-gallery img, .lvs-qr, .lvs-logo")].map((node, index) => ({index, className: node.className, text: node.textContent, top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom, height: node.getBoundingClientRect().height})) }; host.dataset.lvsStatus = result.status;';
    await route.fulfill({ response, body: body.replace(/host\.dataset\.lvsStatus\s*=\s*result\.status;/g, capture) });
  });
  return state;
}

async function showSheet(page: Page, state: FixtureState) {
  await page.goto(`/vehicle/${state.car.id}`);
  const more = page.getByRole('button', { name: 'More vehicle tools', exact: true });
  await expect(more).toBeVisible();
  await more.click();
  await page.getByTestId('button-print-vehicle').click();
  return page.getByRole('dialog', { name: 'Vehicle details', exact: true });
}

async function readySheet(page: Page) {
  const frame = page.frameLocator('iframe[title="Printable vehicle details"]');
  await expect(frame.locator('.lvs-host')).toHaveAttribute('data-lvs-status', /^(ready|overflow|invalid-data|invalid-url|asset-error)$/, { timeout: 30_000 });
  const status = await frame.locator('.lvs-host').getAttribute('data-lvs-status');
  if (status !== 'ready') {
    const fit = await page.evaluate(() => (globalThis as any).__lastSheetFit);
    await test.info().attach('vehicle-sheet-fit', { body: JSON.stringify(fit ?? { status }), contentType: 'application/json' });
    throw new Error(`Vehicle sheet status ${status}: ${JSON.stringify(fit?.metrics ?? fit ?? {})}`);
  }
  await expect(page.getByRole('button', { name: 'Print A4 sheet', exact: true })).toBeEnabled();
  return frame;
}

for (const source of ['autotrader', 'cazoo'] as const) for (const width of [390, 834, 1440]) {
  test(`${source} one-page public sheet remains clear at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 834 ? 1112 : 950 });
    const state = await fixture(page, source);
    const dialog = await showSheet(page, state), frame = await readySheet(page);
    await expect(frame.locator('.lvs-page')).toHaveCount(1);
    await expect(frame.locator('.lvs-price')).toHaveText(source === 'autotrader' ? '£4,958' : '£7,990');
    await expect(frame.locator('.lvs-plate')).toHaveText(state.car.plate);
    await expect(frame.locator('.lvs-disclosures')).toContainText('Category N');
    await expect(frame.locator('.lvs-disclosures')).toContainText(scratch);
    await expect(frame.locator('.lvs-page')).not.toContainText('Sold');
    await expect(frame.locator('.lvs-qr')).toHaveAttribute('href', `${state.canonical}/vehicle/${state.car.id}`);
    await expect(frame.locator('[data-lvs-region="summary"] .lvs-summary')).toContainText('…');
    const geometry = await frame.locator('.lvs-page').evaluate(element => {
      const page = element as HTMLElement, box = page.getBoundingClientRect(), flow = page.querySelector('.lvs-flow')!.getBoundingClientRect(), footer = page.querySelector('.lvs-footer')!.getBoundingClientRect();
      return { width: box.width, height: box.height, flowBottom: flow.bottom, footerTop: footer.top, footerBottom: footer.bottom, pageBottom: box.bottom, scrollWidth: page.scrollWidth, clientWidth: page.clientWidth };
    });
    expect(geometry.width * 25.4 / 96).toBeCloseTo(210, 0);
    expect(geometry.height * 25.4 / 96).toBeCloseTo(297, 0);
    expect(geometry.flowBottom).toBeLessThanOrEqual(geometry.footerTop + 1);
    expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.pageBottom + 1);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await mkdir(output, { recursive: true });
    await dialog.screenshot({ path: resolve(output, `${source}-${width}-preview.png`), animations: 'disabled' });
    await page.locator('iframe[title="Printable vehicle details"]').evaluate((element: HTMLIFrameElement) => {
      element.contentWindow!.print = () => { (window as any).__sheetPrints++; };
    });
    await page.getByRole('button', { name: 'Print A4 sheet', exact: true }).click();
    expect(await page.evaluate(() => (window as any).__sheetPrints)).toBe(1);
    expect(state.vehicleReads).toBe(1);
    expect(state.motReads.every(query => new URLSearchParams(query).get('cacheOnly') === 'true')).toBe(true);
    expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
  });
}

test('fresh price is checked before preparing a sheet, rather than printing the page’s earlier price', async ({ page }) => {
  const state = await fixture(page, 'cazoo');
  await page.goto(`/vehicle/${state.car.id}`);
  await expect(page.getByRole('button', { name: 'More vehicle tools', exact: true })).toBeVisible();
  state.mode = 'price';
  await page.getByRole('button', { name: 'More vehicle tools', exact: true }).click();
  await page.getByTestId('button-print-vehicle').click();
  const frame = await readySheet(page);
  await expect(frame.locator('.lvs-price')).toHaveText('£8,750');
  await expect(frame.locator('[data-lvs-region="summary"]')).toContainText('Freshly supplied vehicle description from the latest feed.');
  await expect(frame.locator('.lvs-features')).toContainText('Panoramic roof from the latest feed');
  expect(state.vehicleReads).toBe(1); expect(state.writes).toEqual([]);
});

for (const mode of ['sold', 'removed', 'failed', 'malformed'] as const) test(`${mode} freshness reply cannot print an earlier available sheet`, async ({ page }) => {
  const state = await fixture(page, 'autotrader');
  await page.goto(`/vehicle/${state.car.id}`);
  await expect(page.getByRole('button', { name: 'More vehicle tools', exact: true })).toBeVisible();
  state.mode = mode;
  await page.getByRole('button', { name: 'More vehicle tools', exact: true }).click();
  await page.getByTestId('button-print-vehicle').click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print A4 sheet', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeDisabled();
  expect(state.vehicleReads).toBe(1); expect(state.writes).toEqual([]);
  if (mode === 'failed') {
    state.mode = 'current';
    await page.getByRole('dialog').getByRole('button', { name: /retry|try again/i }).click();
    await readySheet(page);
    expect(state.vehicleReads).toBe(2);
  }
});

for (const mode of ['current', 'first-due', 'uncached', 'old', 'failed'] as const) test(`${mode} cached MOT information is shown only when verified and fresh`, async ({ page }) => {
  const state = await fixture(page, 'autotrader'); state.mot = mode;
  await showSheet(page, state); const frame = await readySheet(page);
  const text = await frame.locator('.lvs-page').innerText();
  if (mode === 'current') expect(text).toMatch(/(?:MOT|mot)[\s\S]*9 Oct 2027/);
  else if (mode === 'first-due') expect(text).toMatch(/First MOT due[\s\S]*20 May 2028/i);
  else expect(text).not.toMatch(/9 Oct 2027|20 May 2028/);
  expect(state.motReads.length).toBeGreaterThan(0);
  expect(state.motReads.every(query => new URLSearchParams(query).get('cacheOnly') === 'true')).toBe(true);
  expect(state.writes).toEqual([]);
});

for (const source of ['autotrader', 'cazoo'] as const) test(`${source} @pdf download is one A4 page and links to the exact canonical car`, async ({ page }) => {
  const state = await fixture(page, source, source === 'autotrader');
  await page.setViewportSize(test.info().project.name === 'webkit-pdf' ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  await showSheet(page, state); let frame = await readySheet(page);
  if (source === 'cazoo') {
    await page.getByRole('checkbox', { name: /ink.saving/i }).check();
    frame = await readySheet(page);
    await expect(frame.locator('.lvs-page')).toHaveClass(/lvs-mono/);
    expect(await frame.locator('.lvs-main-photo').evaluate(element => getComputedStyle(element).filter)).toContain('grayscale(1)');
  }
  const qrProof = await frame.locator('.lvs-page').evaluate(element => {
    const page = element.getBoundingClientRect(), anchor = element.querySelector<HTMLAnchorElement>('.lvs-qr')!, qr = anchor.getBoundingClientRect(), svg = anchor.querySelector('svg')!, photo = element.querySelector('.lvs-main-photo')!.getBoundingClientRect();
    return { canonical: anchor.href, pageWidth: page.width, pageHeight: page.height, qr: { x: qr.left - page.left, y: qr.top - page.top, width: qr.width, height: qr.height }, photo: { x: photo.left - page.left, y: photo.top - page.top, width: photo.width, height: photo.height }, modulesWithQuietZone: Number(svg.getAttribute('viewBox')!.split(' ')[2]), path: svg.querySelector('path')!.getAttribute('d') };
  });
  const downloaded = page.waitForEvent('download', { timeout: 60_000 });
  const exportOutcome = Promise.race([downloaded, page.getByRole('dialog').getByRole('alert').waitFor({ state: 'visible', timeout: 60_000 }).then(async () => {
    await test.info().attach('pdf-export-diagnostics', { body: JSON.stringify({ alert: await page.getByRole('dialog').getByRole('alert').innerText(), network: state.networkIssues, console: state.consoleErrors, proxy: state.imageProxyReads }), contentType: 'application/json' });
    throw new Error(`PDF export failed: ${state.networkIssues.join('; ')} ${state.consoleErrors.join('; ')}`);
  })]);
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const download = await exportOutcome;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  await mkdir(output, { recursive: true });
  const file = resolve(output, `${source}${source === 'cazoo' ? '-ink-saving' : ''}${test.info().project.name === 'webkit-pdf' ? '-webkit-phone' : ''}.pdf`);
  await writeFile(file.replace(/\.pdf$/, '-qr-proof.json'), JSON.stringify(qrProof, null, 2));
  await download.saveAs(file); expect(await download.failure()).toBeNull();
  const bytes = await readFile(file); expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const document = await loadingTask.promise;
  expect(document.numPages).toBe(1);
  const pdfPage = await document.getPage(1), box = pdfPage.getViewport({ scale: 1 });
  expect(box.width).toBeCloseTo(595.28, 0); expect(box.height).toBeCloseTo(841.89, 0);
  const annotations = await pdfPage.getAnnotations();
  expect(annotations.some(annotation => annotation.url === `${state.canonical}/vehicle/${state.car.id}`)).toBe(true);
  // Structural PDF validity cannot detect Safari silently exporting a white
  // photograph. Inspect the actual embedded A4 raster, not the preview DOM.
  const operators = await pdfPage.getOperatorList();
  const imageOperation = operators.fnArray.findIndex(operator => operator === OPS.paintImageXObject);
  expect(imageOperation).toBeGreaterThanOrEqual(0);
  const raster = pdfPage.objs.get(operators.argsArray[imageOperation][0]) as { width: number; height: number; kind: number; data: Uint8Array };
  expect(raster.width).toBeGreaterThan(2000);
  expect([2, 3]).toContain(raster.kind);
  const channels = raster.kind === 3 ? 4 : 3;
  let colouredPhotoPixels = 0, sampleCount = 0, channelDifference = 0;
  for (let row = 0; row < 40; row++) for (let column = 0; column < 40; column++) {
    const x = Math.floor((qrProof.photo.x + qrProof.photo.width * (.15 + column / 40 * .7)) / qrProof.pageWidth * raster.width);
    const y = Math.floor((qrProof.photo.y + qrProof.photo.height * (.15 + row / 40 * .7)) / qrProof.pageHeight * raster.height);
    const offset = (y * raster.width + x) * channels;
    const [r, g, b] = raster.data.subarray(offset, offset + 3);
    if (Math.min(r, g, b) < 225) colouredPhotoPixels++;
    channelDifference = Math.max(channelDifference, Math.abs(r - g), Math.abs(g - b));
    sampleCount++;
  }
  expect(colouredPhotoPixels / sampleCount, 'The downloaded PDF must contain the vehicle photograph, rather than a white placeholder.').toBeGreaterThan(.25);
  if (source === 'cazoo') expect(channelDifference).toBe(0);
  await loadingTask.destroy();
  if (source === 'autotrader') expect(state.imageProxyReads.length).toBeGreaterThan(0);
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

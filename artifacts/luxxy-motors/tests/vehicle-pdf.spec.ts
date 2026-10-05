import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Car, StockData } from '../src/lib/stock-context';
import { vehiclePrintData } from '../src/lib/vehicle-print-data';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Read-only local preview print checks.');
test.describe.configure({ mode: 'serial' });

const normalise = (value: string) => value.replace(/\s+/g, ' ').trim();
const temporary = resolve('../../tmp/pdfs/vehicle-details');
const output = resolve('../../output/pdf');

async function currentStock(request: APIRequestContext) {
  const response = await request.get('/api/stock');
  expect(response.ok()).toBe(true);
  const stock = await response.json() as StockData;
  expect(stock.cars.length).toBeGreaterThan(0);
  return stock.cars;
}

function suppliedText(car: Car) {
  const data = vehiclePrintData(car);
  return { title: data.title, price: data.price, priceNote: data.priceNote ?? null,
    description: data.description ? normalise(data.description) : null, features: data.features,
    facts: data.facts, specifications: data.specificationGroups.flatMap(group => group.facts),
    costs: data.runningCosts, history: data.history, sourceNotes: data.sourceNotes };
}

function contentSize(car: Car) {
  const supplied = suppliedText(car);
  return (supplied.description?.length ?? 0) + supplied.features.join(' ').length +
    [...supplied.facts, ...supplied.specifications, ...supplied.costs, ...supplied.history].reduce((length, item) => length + item.label.length + item.value.length, 0);
}

async function preparePrint(page: Page, car: Car, width: number) {
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width, height: 950 });
  await page.addInitScript(() => {
    window.print = () => { document.documentElement.dataset.printRequested = 'true'; };
  });
  // Any accidental data mutation in this verification should fail rather than
  // leaving enquiries, reservations or settings behind.
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method())
    ? route.continue()
    : route.fulfill({ status: 405, json: { error: 'Read-only print verification.' } }));
  await page.goto(`/vehicle/${encodeURIComponent(car.id)}`, { waitUntil: 'domcontentloaded' });
  if (width < 768) await page.getByTestId('vehicle-secondary-actions').getByRole('button', { name: 'More options', exact: true }).click();
  const button = page.getByTestId('button-print-vehicle');
  await expect(button).toHaveAccessibleName(/Print vehicle details for /);
  await button.scrollIntoViewIfNeeded();
  await button.focus();
  await expect(button).toBeFocused();
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await button.press('Enter');
  const sheet = page.locator('.vehicle-print-sheet');
  await expect(sheet).toHaveAttribute('data-print-ready', 'true', { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-print-requested', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.emulateMedia({ media: 'print' });
  await expect(sheet).toBeVisible();
  await expect(page.locator('#root')).toBeHidden();
  return sheet;
}

async function assertCompletePrint(page: Page, car: Car) {
  const sheet = page.locator('.vehicle-print-sheet');
  const text = normalise(await sheet.innerText());
  const supplied = suppliedText(car);
  for (const value of [supplied.title, supplied.price, supplied.priceNote]) if (value) expect(text).toContain(normalise(value));
  if (supplied.description) expect(text).toContain(supplied.description);
  else await expect(sheet.locator('.vehicle-print-description')).toHaveCount(0);
  for (const feature of supplied.features) expect(text).toContain(normalise(feature));
  if (!supplied.features.length) await expect(sheet.locator('.vehicle-print-features')).toHaveCount(0);
  for (const item of [...supplied.facts, ...supplied.specifications, ...supplied.costs, ...supplied.history]) {
    expect(text, `${car.make} ${car.model}: ${item.label}`).toContain(normalise(item.value));
  }
  for (const note of supplied.sourceNotes) expect(text).toContain(normalise(note));
  for (const value of [car.variant, car.colour, car.transmission, car.fuel, car.bodyType, car.emissionClass]) {
    if (value) expect(text).toContain(normalise(value));
  }
  expect(text).not.toMatch(/Photograph unavailable|Vehicle photographs not supplied|Not supplied|Not provided|Price on application|Contact the dealership for the full specification|\+\s*\d+\s+more features|This is a summary\./i);
  if (![supplied.description ?? '', ...supplied.features].some(value => value.includes('…'))) expect(text).not.toContain('…');
  const images = sheet.locator('img');
  expect(await images.evaluateAll(elements => elements.every(element => {
    const image = element as HTMLImageElement;
    return image.complete && image.naturalWidth > 0;
  }))).toBe(true);
  expect(await sheet.locator('footer').innerText()).not.toMatch(/sample (?:address|postcode)|example road|your (?:dealership|address)|@example\.(?:com|org|net)/i);
  // A fixed-size image grid can still let its implicit rows grow over the facts.
  // Verify photograph frames and images are contained, rather than trusting the
  // outer sheet height alone.
  const photoGeometry = await sheet.evaluate(element => {
    const gallery = element.querySelector('.vehicle-print-photos')?.getBoundingClientRect();
    if (!gallery) return [];
    const facts = element.querySelector('.vehicle-print-facts')?.getBoundingClientRect();
    return Array.from(element.querySelectorAll('.vehicle-print-photo')).map(frame => {
      const boundary = frame.getBoundingClientRect();
      const image = frame.querySelector('img')!.getBoundingClientRect();
      const caption = frame.querySelector('figcaption')?.getBoundingClientRect();
      return { galleryBottom: gallery.bottom, frameBottom: boundary.bottom, imageBottom: image.bottom,
        captionTop: caption?.top ?? null, captionBottom: caption?.bottom ?? null, factsTop: facts?.top ?? null };
    });
  });
  for (const photograph of photoGeometry) {
    expect(photograph.frameBottom).toBeLessThanOrEqual(photograph.galleryBottom + 1);
    expect(photograph.imageBottom).toBeLessThanOrEqual(photograph.frameBottom + 1);
    if (photograph.captionBottom !== null) expect(photograph.captionBottom).toBeLessThanOrEqual(photograph.frameBottom + 1);
    if (photograph.captionTop !== null) expect(photograph.imageBottom).toBeLessThanOrEqual(photograph.captionTop + 1);
    if (photograph.factsTop !== null) expect(photograph.galleryBottom).toBeLessThanOrEqual(photograph.factsTop + 1);
  }
  const geometry = await sheet.evaluate(element => {
    const boundary = element.getBoundingClientRect();
    const content = element.querySelector('.vehicle-print-page')!.getBoundingClientRect();
    const footer = element.querySelector('footer')!.getBoundingClientRect();
    return { boundary: { width: boundary.width, height: boundary.height, left: boundary.left, right: boundary.right, bottom: boundary.bottom }, content: { left: content.left, right: content.right, bottom: content.bottom }, footerBottom: footer.bottom };
  });
  expect(geometry.content.left).toBeGreaterThanOrEqual(geometry.boundary.left - 1);
  expect(geometry.content.right).toBeLessThanOrEqual(geometry.boundary.right + 1);
  expect(geometry.content.bottom).toBeLessThanOrEqual(geometry.boundary.bottom + 1);
  expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.boundary.bottom + 1);
  return { carId: car.id, make: car.make, model: car.model, text, expected: supplied, geometry, density: await sheet.getAttribute('data-print-density') };
}

test('every imported vehicle prints complete supplied details in one A4 sheet', async ({ page, request }) => {
  test.setTimeout(240_000);
  const cars = await currentStock(request);
  const dense = [...cars].sort((left, right) => contentSize(right) - contentSize(left))[0];
  const sparse = [...cars].sort((left, right) => contentSize(left) - contentSize(right))[0];
  await mkdir(temporary, { recursive: true });
  await mkdir(output, { recursive: true });
  const manifest = [];
  for (const car of cars) {
    const result = await test.step(`${car.year} ${car.make} ${car.model} (${car.id})`, async () => {
      await preparePrint(page, car, 1440);
      return assertCompletePrint(page, car);
    });
    const pdf = resolve(temporary, `${car.id}.pdf`);
    await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
    if (car.id === dense.id) {
      await page.pdf({ path: resolve(output, 'luxxy-vehicle-details.pdf'), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
      await page.locator('.vehicle-print-sheet').screenshot({ path: resolve(temporary, 'dense-desktop.png') });
    }
    if (car.id === sparse.id) await page.locator('.vehicle-print-sheet').screenshot({ path: resolve(temporary, 'sparse-desktop.png') });
    manifest.push({ ...result, pdf });
  }
  await writeFile(resolve(temporary, 'verification-manifest.json'), JSON.stringify(manifest, null, 2));
});

test('phone printing preserves the full dense vehicle content and A4 layout', async ({ page, request }) => {
  test.setTimeout(90_000);
  const cars = await currentStock(request);
  const car = [...cars].sort((left, right) => contentSize(right) - contentSize(left))[0];
  await preparePrint(page, car, 390);
  const result = await assertCompletePrint(page, car);
  await mkdir(temporary, { recursive: true });
  await page.pdf({ path: resolve(temporary, 'dense-mobile.pdf'), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
  await page.locator('.vehicle-print-sheet').screenshot({ path: resolve(temporary, 'dense-mobile.png') });
  await writeFile(resolve(temporary, 'mobile-verification.json'), JSON.stringify(result, null, 2));
});

import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Read-only local visual audit only.');
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
const output = '/tmp/luxxy-typography-spacing-audit';

async function inspect(page: Page, name: string) {
  await expect(page.locator('#main-content h1').first()).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const image of document.images) image.loading = 'eager';
    await Promise.race([
      Promise.all([...document.images].map(image => image.decode().catch(() => undefined))),
      new Promise(resolve => setTimeout(resolve, 1500)),
    ]);
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  const report = await page.evaluate(() => {
    const main = document.querySelector('#main-content')!;
    const colour = (value: string) => {
      const match = value.match(/[\d.]+/g);
      return match ? [Number(match[0]), Number(match[1]), Number(match[2]), match[3] === undefined ? 1 : Number(match[3])] : [0, 0, 0, 0];
    };
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map(value => {
      const unit = value / 255;
      return unit <= .04045 ? unit / 12.92 : ((unit + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const contrastIssues: { text: string; selector: string; ratio: number; required: number; colour: string; background: string }[] = [];
    const tinyInputs: string[] = [];
    for (const element of main.querySelectorAll<HTMLElement>('*')) {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (bounds.width < 2 || bounds.height < 2 || style.visibility === 'hidden' || style.display === 'none' || style.clipPath !== 'none' || element.closest('.sr-only')) continue;
      if (element.matches('input:not([type=checkbox]):not([type=radio]), select, textarea') && Number.parseFloat(style.fontSize) < 16) {
        tinyInputs.push(element.dataset.testid || element.getAttribute('aria-label') || element.tagName);
      }
      const text = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(' ').trim();
      if (!text || element.closest('[aria-hidden=true], [disabled]')) continue;
      let ancestor: Element | null = element;
      let background: number[] | undefined;
      let photoSurface = false;
      while (ancestor) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (Number(ancestorStyle.opacity) < 1) { photoSurface = true; break; }
        if (ancestorStyle.backgroundImage !== 'none') { photoSurface = true; break; }
        const parsed = colour(ancestorStyle.backgroundColor);
        if (parsed[3] > .98) { background = parsed; break; }
        if (parsed[3] > 0) { photoSurface = true; break; }
        ancestor = ancestor.parentElement;
      }
      if (photoSurface || !background) continue;
      const foreground = colour(style.color);
      if (foreground[3] < 1) continue;
      const fore = luminance(foreground), back = luminance(background);
      const ratio = (Math.max(fore, back) + .05) / (Math.min(fore, back) + .05);
      const size = Number.parseFloat(style.fontSize), weight = Number.parseInt(style.fontWeight);
      const required = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
      if (ratio + .01 < required) contrastIssues.push({ text: text.slice(0, 85), selector: element.dataset.testid || element.className || element.tagName, ratio: Number(ratio.toFixed(2)), required, colour: style.color, background: background.slice(0, 3).join(', ') });
    }
    const heading = main.querySelector('h1')!;
    const headingStyle = getComputedStyle(heading);
    const bodyStyle = getComputedStyle(main);
    const faces = [...document.fonts].map(font => ({ family: font.family, status: font.status, weight: font.weight }));
    return {
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      heading: { font: headingStyle.fontFamily, size: headingStyle.fontSize, lineHeight: headingStyle.lineHeight },
      body: { font: bodyStyle.fontFamily, size: bodyStyle.fontSize },
      headerFont: getComputedStyle(document.querySelector('[data-site-header]')!).fontFamily,
      faces, tinyInputs, contrastIssues,
    };
  });
  expect(report.scrollWidth, name + ' must fit the viewport').toBeLessThanOrEqual(report.width + 1);
  await test.info().attach(`${name}-computed-styles`, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: `${output}/${name}-${page.viewportSize()!.width}.png`, fullPage: true, animations: 'disabled' });
  await page.screenshot({ path: `${output}/${name}-${page.viewportSize()!.width}-viewport.png`, animations: 'disabled' });
  console.log(`${name} ${report.width}px ${JSON.stringify(report)}`);
  if (report.width <= 1024) expect.soft(report.tinyInputs, name + ' form controls should avoid iOS zoom').toEqual([]);
  expect.soft(report.heading.font, name + ' heading font').toContain('Inter');
  expect.soft(report.body.font, name + ' body font').toContain('Inter');
  expect.soft(report.headerFont, name + ' navigation font').toContain('Inter');
  expect.soft(report.faces.some(face => face.family.replaceAll('"', '') === 'Inter' && face.status === 'loaded'), name + ' must use the loaded local font').toBe(true);
  expect.soft(report.contrastIssues, name + ' text on solid surfaces should meet its size-specific contrast ratio').toEqual([]);
  return report;
}

for (const width of [390, 820, 1440]) {
  test.describe(`${width}px device`, () => {
  test.use({ hasTouch: width <= 1024, isMobile: width === 390 });
  test(`public fonts, spacing and colour evidence at ${width}px`, async ({ page, request }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 1000 });
    const writes: string[] = [], errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
      writes.push(route.request().method() + ' ' + new URL(route.request().url()).pathname);
      return route.abort('blockedbyclient');
    });
    await page.route('https://fonts.googleapis.com/**', route => route.abort('blockedbyclient'));
    await page.route('https://fonts.gstatic.com/**', route => route.abort('blockedbyclient'));
    const baseline = await (await request.get('/api/stock')).json();
    const car = baseline.cars.find((item: any) => item.inventoryStatus === 'available') ?? baseline.cars[0];
    expect(car, 'An available preview car is needed for the audit').toBeTruthy();
    for (const [name, path] of [
      ['home', '/'], ['stock', '/stock'], ['no-matches', '/stock?search=fictional-no-matching-car'],
      ['vehicle', `/vehicle/${car.id}`], ['contact', '/contact'], ['warranty', '/warranty'],
      ['enquiry', `/enquire?type=general&vehicleId=${car.id}`], ['booking', `/enquire?type=viewing&vehicleId=${car.id}`],
      ['saved-empty', '/saved'],
    ]) {
      await page.goto(path);
      if (name === 'stock') await expect(page.locator('.browse-stock .vehicle-card').first()).toBeVisible();
      await inspect(page, name);
      if (name === 'stock') {
        await page.getByRole('button', { name: 'Advanced search', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Filter used cars', exact: true });
        await expect(dialog).toBeVisible();
        await expect.poll(() => dialog.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
        })).toBe(true);
        await dialog.screenshot({ path: `${output}/filters-${width}.png`, animations: 'disabled' });
        await page.keyboard.press('Escape');
      }
      if (name === 'vehicle') {
        await page.getByRole('button', { name: 'View gallery fullscreen', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Vehicle image gallery', exact: true });
        await expect(dialog).toBeVisible();
        await expect.poll(() => dialog.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
        })).toBe(true);
        expect(await dialog.getByRole('button', { name: 'Message', exact: true }).evaluate(element => getComputedStyle(element).fontFamily)).toContain('Inter');
        await expect.poll(() => dialog.locator('.vehicle-lightbox-photo img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        await dialog.screenshot({ path: `${output}/gallery-${width}.png`, animations: 'disabled' });
        await dialog.getByRole('button', { name: 'All photos', exact: true }).click();
        await dialog.screenshot({ path: `${output}/gallery-overview-${width}.png`, animations: 'disabled' });
        await page.keyboard.press('Escape');
      }
    }
    await page.goto(`/vehicle/${car.id}`);
    await page.getByRole('button', { name: /Save .* to your saved cars/ }).click();
    await page.goto('/saved');
    await expect(page.getByTestId('text-saved-count')).toContainText('1 car saved');
    await expect(page.locator('.saved-car-list details')).toHaveCount(0);
    if (width >= 768) {
      const photoColumn = page.locator('.saved-car-list .vehicle-card-photo').first();
      const columnBounds = await photoColumn.boundingBox();
      const linkBounds = await photoColumn.locator('> a[data-stock-link]').boundingBox();
      expect(Math.abs((columnBounds!.y + columnBounds!.height / 2) - (linkBounds!.y + linkBounds!.height / 2)), 'A contained saved photo should sit centrally in the stretched row').toBeLessThanOrEqual(1);
    }
    await inspect(page, 'saved-shortlist');
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
  });
}

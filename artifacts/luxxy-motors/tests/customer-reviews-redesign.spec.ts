import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const longReview = 'They answered my questions, let me take my time looking around the car and explained the paperwork clearly. '.repeat(7).trim();
const reviews = [
  { rating: 5, review: 'The car was ready when I arrived and the team explained everything clearly.', name: 'First test customer', date: 'October 2026', source: 'Google', verified: true, invited: false },
  { rating: 4, review: longReview, name: 'Second test customer', date: 'October 2026', source: 'Google', verified: false, invited: true },
  { rating: 5, review: 'A straightforward visit. There was plenty of time to ask questions before deciding.', name: 'Third test customer', date: 'September 2026', source: 'Auto Trader', verified: false, invited: false },
  { rating: 5, review: 'Everything was as described and I drove away happy with my purchase.', name: 'Fourth test customer', date: 'September 2026', source: '', verified: true, invited: false },
];

async function mockPresentation(page: Page, request: APIRequestContext, presentation: Record<string, unknown> = {}) {
  const settings = await (await request.get('/api/dealer-settings')).json();
  await page.route('**/api/dealer-settings', route => route.fulfill({
    json: { ...settings, presentation: { ...settings.presentation, reviewsEnabled: true, reviews, reviewsUrl: '', ...presentation } },
  }));
}

async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const width of [320, 390, 820, 1440]) {
  test(`reviews remain readable and browsable at ${width}px`, async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockPresentation(page, request);
    await page.goto('/');
    const section = page.getByRole('region', { name: 'What our customers say', exact: true });
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible();
    await expect(section.getByRole('listitem')).toHaveCount(4);
    await expect(section.getByText(reviews[0].review, { exact: true })).toBeVisible();
    await expect(section.getByRole('link')).toHaveCount(0);
    const track = section.getByRole('list', { name: 'Customer reviews', exact: true });
    const previous = section.getByRole('button', { name: 'Previous reviews', exact: true });
    await expect(previous).toBeDisabled();
    await section.screenshot({ path: `../../output/customer-reviews-redesign/reviews-${width}.png`, animations: 'disabled' });
    const next = section.getByRole('button', { name: 'Next reviews', exact: true });
    for (const control of [previous, next]) {
      const box = await control.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await next.click();
    await expect.poll(() => track.evaluate(node => node.scrollLeft)).toBeGreaterThan(50);
    await previous.click();
    await expect.poll(() => track.evaluate(node => node.scrollLeft)).toBeLessThan(3);
    await track.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => track.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    await noPageOverflow(page);
    expect(errors).toEqual([]);
  });
}

test('long quotations expand and collapse without changing their text', async ({ page, request }) => {
  await mockPresentation(page, request, { reviews: [reviews[1]] });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/');
  const section = page.getByRole('region', { name: 'What our customers say', exact: true });
  await section.scrollIntoViewIfNeeded();
  const quote = section.locator('blockquote');
  await expect(quote).toHaveText(longReview);
  const collapsedHeight = (await quote.boundingBox())!.height;
  const expand = section.getByRole('button', { name: 'Read full review', exact: true });
  expect((await expand.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expand.click();
  const collapse = section.getByRole('button', { name: 'Show less', exact: true });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  expect((await quote.boundingBox())!.height).toBeGreaterThan(collapsedHeight);
  await expect(quote).toHaveText(longReview);
  await collapse.click();
  await expect(section.getByRole('button', { name: 'Read full review', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await noPageOverflow(page);
});

test('one review needs no carousel arrows and keeps supplied content', async ({ page, request }) => {
  await mockPresentation(page, request, { reviews: [reviews[0]] });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/');
  const section = page.getByRole('region', { name: 'What our customers say', exact: true });
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole('listitem')).toHaveCount(1);
  await expect(section.getByRole('button', { name: /^(Previous|Next) reviews$/ })).toHaveCount(0);
  await expect(section.getByText(reviews[0].review, { exact: true })).toBeVisible();
  await noPageOverflow(page);
});

for (const presentation of [{ reviews: [] }, { reviewsEnabled: false }]) {
  test(`reviews hide cleanly when ${presentation.reviews ? 'empty' : 'disabled'}`, async ({ page, request }) => {
    await mockPresentation(page, request, presentation);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'What our customers say', exact: true })).toHaveCount(0);
    await noPageOverflow(page);
  });
}

test('configured review source link opens safely and custom heading remains', async ({ page, request }) => {
  const settings = await (await request.get('/api/dealer-settings')).json();
  await mockPresentation(page, request, {
    reviewsUrl: 'https://example.com/our-reviews',
    websiteCopy: { ...settings.presentation?.websiteCopy, reviewsHeading: 'Feedback from our customers' },
  });
  await page.goto('/');
  const section = page.getByRole('region', { name: 'Feedback from our customers', exact: true });
  await section.scrollIntoViewIfNeeded();
  const link = section.getByRole('link');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('href', 'https://example.com/our-reviews');
  await expect(link).toHaveAttribute('target', '_blank');
  expect(await link.getAttribute('rel')).toContain('noopener');
  await expect(section.getByRole('heading', { name: 'Feedback from our customers', exact: true })).toBeVisible();
});


test('arrows respond to screen size and disable at either end', async ({ page, request }) => {
  await mockPresentation(page, request, { reviews: reviews.slice(0, 2) });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const section = page.getByRole('region', { name: 'What our customers say', exact: true });
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole('navigation', { name: 'Browse customer reviews', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 900 });
  const next = section.getByRole('button', { name: 'Next reviews', exact: true });
  const previous = section.getByRole('button', { name: 'Previous reviews', exact: true });
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await next.click();
  await expect(next).toBeDisabled();
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(section.getByRole('navigation', { name: 'Browse customer reviews', exact: true })).toHaveCount(0);
  await noPageOverflow(page);
});

test('dark page with light panel settings keeps review text and controls legible', async ({ page, request }) => {
  await mockPresentation(page, request, {
    pageColour: '#192a36', panelColour: '#ffffff', headingColour: '#5b2635', linkColour: '#215a7e',
    reviewsUrl: 'https://example.com/our-reviews',
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const section = page.getByRole('region', { name: 'What our customers say', exact: true });
  await section.scrollIntoViewIfNeeded();
  await expect(section).toHaveCSS('background-color', 'rgb(25, 42, 54)');
  await expect(section.getByRole('listitem').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  // Calculate against the composited visible surface, including transparent
  // review panels. Checking the theme variables alone misses inherited CSS
  // from the former white review cards.
  const readable = async (selector: string, minimum = 4.5) => {
    const contrast = await section.locator(selector).first().evaluate(node => {
      const rgb = (colour: string) => colour.match(/[\d.]+/g)?.map(Number) ?? [];
      const composite = (front: number[], back: number[]) => {
        const alpha = front.length > 3 ? front[3] : 1;
        return front.slice(0, 3).map((value, index) => value * alpha + back[index] * (1 - alpha));
      };
      const ancestors: Element[] = [];
      for (let element: Element | null = node; element; element = element.parentElement) ancestors.unshift(element);
      const surface = ancestors.reduce((background, ancestor) => composite(rgb(getComputedStyle(ancestor).backgroundColor), background), [255, 255, 255]);
      const luminance = (channels: number[]) => channels.map(value => {
        const unit = value / 255;
        return unit <= .04045 ? unit / 12.92 : ((unit + .055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const colour = getComputedStyle(node).color;
      const foreground = luminance(composite(rgb(colour), surface));
      const background = luminance(surface);
      return { ratio: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05), colour, surface, text: node.textContent?.trim() };
    });
    expect.soft(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(minimum);
  };
  for (const selector of ['h2', '.review-count', 'blockquote', 'cite', '.review-source-row', '.review-verification', '.review-invited', '.review-read-more', '.review-all-link']) {
    await readable(selector);
  }
  await readable('.review-navigation button:not(:disabled)', 3);
  await section.getByRole('button', { name: 'Next reviews', exact: true }).hover();
  await readable('.review-navigation button:not(:disabled)', 3);
  const invited = section.getByRole('button', { name: 'Invited', exact: true });
  const box = await invited.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await noPageOverflow(page);
  await section.screenshot({ path: '../../output/customer-reviews-redesign/reviews-dark-page.png', animations: 'disabled' });
});

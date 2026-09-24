import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

// Opt-in evidence collection for local visual reviews; all records are preview fixtures.
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1' || process.env.LUXXY_QA_SCREENSHOTS !== '1', 'Run explicitly against the read-only local preview.');

for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
  test(`capture final visual QA at ${name} size`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height });
    const directory = resolve(
      "../../docs/screenshots",
      ["template-refinement", "homepage-polish", "brand-hero", "booking-polish", "introduction-polish", "design-check-fixes"].includes(process.env.LUXXY_QA_SCREENSHOT_SET || "")
        ? process.env.LUXXY_QA_SCREENSHOT_SET!
        : "ui-qa",
    );
    await mkdir(directory, { recursive: true });
    const capture = async (screen: string) => {
      await expect(page.locator('#main-content h1')).toBeVisible();
      // Request all photographs together. A slow external host must not leave the
      // collector waiting indefinitely; record unavailable images with the evidence.
      const unavailableImages = await page.evaluate(async () => {
        const images = Array.from(document.querySelectorAll('img'));
        for (const image of images) image.loading = 'eager';
        await Promise.race([
          Promise.all([document.fonts.ready, ...images.map(image => image.decode().catch(() => undefined))]),
          new Promise(resolve => setTimeout(resolve, 5_000)),
        ]);
        window.scrollTo({ top: 0, behavior: 'instant' });
        return images.filter(image => !image.complete || image.naturalWidth === 0)
          .map(image => ({ src: image.currentSrc || image.src, alt: image.alt }));
      });
      if (unavailableImages.length) {
        await test.info().attach(`${screen}-${name}-unavailable-images`, {
          body: JSON.stringify(unavailableImages, null, 2), contentType: 'application/json',
        });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: resolve(directory, `${screen}-${name}.png`), fullPage: true, animations: 'disabled' });
      if (['home', 'vehicle', 'staff-desk', 'settings', 'booking', 'booking-details'].includes(screen)) {
        await page.screenshot({ path: resolve(directory, `${screen}-${name}-viewport.png`), animations: 'disabled' });
      }
    };
    if (process.env.LUXXY_QA_SCREENSHOT_SET === 'booking-polish') {
      await page.goto('/enquire?type=viewing&vehicleId=preview-4');
      await expect(page.getByTestId('group-viewing-slots')).toBeVisible();
      await capture('booking');
      await page.getByTestId('group-viewing-slots').getByRole('button').first().click();
      await page.getByTestId('button-continue-to-details').click();
      await expect(page.getByTestId('input-customer-name')).toBeFocused();
      await capture('booking-details');
      await page.getByRole('link', { name: 'Change car', exact: true }).filter({ visible: true }).click();
      await expect(page.getByRole('heading', { name: 'Latest arrivals' })).toBeFocused();
      await expect(page.getByRole('heading', { name: 'Latest arrivals' })).toBeInViewport();
      return;
    }
    await page.goto('/');
    await expect(page.getByTestId('card-vehicle-preview-1')).toBeVisible();
    await capture('home');
    if (process.env.LUXXY_QA_SCREENSHOT_SET === 'introduction-polish') {
      const introduction = page.getByRole('region', { name: 'Come and see for yourself.' });
      const heroImage = page.getByTestId('showroom-hero-photo').getByRole('img');
      await expect(introduction.getByRole('img')).toHaveAttribute('src', (await heroImage.getAttribute('src'))!);
      await expect(introduction.getByRole('img')).toHaveJSProperty('naturalWidth', 1536);
      // Give a tall mobile section enough canvas that the sticky site header
      // cannot cover its title in the element capture. Full-page evidence above
      // retains the standard 390×844 viewport.
      const sectionBox = await introduction.boundingBox();
      const headerHeight = await page.locator('[data-site-header]').evaluate((element) => element.getBoundingClientRect().height);
      await page.setViewportSize({ width, height: Math.max(height, Math.ceil(sectionBox!.height + headerHeight + 48)) });
      await introduction.evaluate((element, offset) => window.scrollTo({ top: scrollY + element.getBoundingClientRect().top - offset, behavior: 'instant' }), headerHeight + 24);
      await introduction.screenshot({ path: resolve(directory, `introduction-${name}.png`), animations: 'disabled' });
      await page.setViewportSize({ width, height });
      await introduction.getByRole('link', { name: 'Arrange a viewing' }).click();
      await expect(page.getByRole('heading', { name: 'Book a viewing', exact: true })).toBeVisible();
      await expect(page.getByTestId('group-viewing-slots')).toBeVisible();
      return;
    }
    if (process.env.LUXXY_QA_SCREENSHOT_SET === 'brand-hero') {
      const hero = page.getByTestId('showroom-hero-photo');
      await expect(hero).toHaveAttribute('href', '/#stock');
      await expect(hero).not.toContainText('£');
      await expect(hero.locator('img')).toHaveJSProperty('naturalWidth', 1536);
      await hero.click();
      await expect(page.getByRole('heading', { name: 'Latest arrivals' })).toBeInViewport();
      return;
    }
    if (process.env.LUXXY_QA_SCREENSHOT_SET === 'homepage-polish') {
      await page.locator('#about').screenshot({ path: resolve(directory, `introduction-${name}.png`), animations: 'disabled' });
      await page.getByTestId('card-vehicle-preview-1').screenshot({ path: resolve(directory, `vehicle-card-${name}.png`), animations: 'disabled' });
      await page.getByRole('button', { name: 'Advanced search' }).click();
      await expect(page.getByRole('combobox', { name: 'Make', exact: true })).toBeVisible();
      await page.getByTestId('stock-search-toolbar').screenshot({ path: resolve(directory, `filters-${name}.png`), animations: 'disabled' });
      return;
    }
    await page.getByTestId('button-save-preview-1').click();
    await page.getByTestId('button-compare-preview-1').click();
    await page.getByTestId('button-compare-preview-2').click();
    for (const [screen, path] of [
      ['vehicle', '/vehicle/preview-1'], ['saved', '/saved'], ['compare', '/compare'],
      ['booking', '/enquire?type=viewing&vehicleId=preview-1'], ['part-exchange', '/enquire?type=part_exchange'],
      ['customer-details', '/customer-details/sample'], ['viewing', '/viewing/sample'], ['signing', '/sign/sample'],
      ['staff-desk', '/portal'], ['lead', '/portal/leads/sample-lead-1'],
    ]) {
      await page.goto(path);
      if (screen === 'booking') await expect(page.getByTestId('group-viewing-slots')).toBeVisible();
      if (screen === 'staff-desk') await expect(page.getByTestId('work-queue')).toBeVisible();
      if (screen === 'lead') await expect(page.getByTestId('lead-detail')).toBeVisible();
      await capture(screen);
    }
    await page.goto('/portal');
    await page.getByTestId('tab-leads').click();
    await expect(page.getByText('Amelia Clarke').first()).toBeVisible();
    await capture('leads');
    await page.getByTestId('tab-channels').click();
    await expect(page.getByTestId('channel-summary')).toBeVisible();
    await capture('channels');
    await page.getByTestId('tab-settings').click();
    await expect(page.getByTestId('input-identity-name')).toHaveValue('Luxxy Motors');
    await capture('settings');
    if (process.env.LUXXY_QA_SCREENSHOT_SET === "template-refinement") {
      await page.getByTestId("button-settings-nav-presentation").click();
      await page.locator("#settings-presentation").screenshot({
        path: resolve(directory, `onboarding-${name}.png`),
        animations: 'disabled',
      });
    }

  });
}

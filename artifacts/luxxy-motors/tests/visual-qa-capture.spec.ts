import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

// Opt-in evidence collection for local visual reviews; all records are preview fixtures.
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1' || process.env.LUXXY_QA_SCREENSHOTS !== '1', 'Run explicitly against the read-only local preview.');

for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
  test(`capture final visual QA at ${name} size`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height });
    const directory = resolve(
      "../../docs/screenshots",
      ["template-refinement", "homepage-polish", "brand-hero"].includes(process.env.LUXXY_QA_SCREENSHOT_SET || "")
        ? process.env.LUXXY_QA_SCREENSHOT_SET!
        : "ui-qa",
    );
    await mkdir(directory, { recursive: true });
    const capture = async (screen: string) => {
      await expect(page.locator('#main-content h1')).toBeVisible();
      // Load the visible page's lazy photographs before collecting full-page evidence.
      await page.evaluate(async () => {
        for (const image of document.querySelectorAll('img')) {
          image.loading = 'eager';
          await image.decode().catch(() => undefined);
        }
        await document.fonts.ready;
        window.scrollTo({ top: 0, behavior: 'instant' });
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: resolve(directory, `${screen}-${name}.png`), fullPage: true, animations: 'disabled' });
      if (['home', 'vehicle', 'staff-desk', 'settings'].includes(screen)) {
        await page.screenshot({ path: resolve(directory, `${screen}-${name}-viewport.png`), animations: 'disabled' });
      }
    };
    await page.goto('/');
    await expect(page.getByTestId('card-vehicle-preview-1')).toBeVisible();
    await capture('home');
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
    await page.getByTestId('tab-deals').click();
    await page.getByRole('button').filter({ hasText: 'Amelia Clarke' }).click();
    await capture('deal');
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
    await page.goto('/find-my-car');
    for (const choice of ['10000-15000', 'saloon', 'diesel', 'automatic', 'commute']) {
      await page.getByTestId(`option-${choice}`).click();
      await page.getByTestId(choice === 'commute' ? 'button-see-matches' : 'button-next-question').click();
    }
    await capture('finder');
    await page.getByTestId('button-recommendation-view-compact').click();
    await expect(page.getByTestId('list-recommendations')).toHaveAttribute('data-recommendation-view', 'compact');
    await page.getByTestId('button-recommendation-view-shortlist').click();
    await expect(page.getByTestId('list-recommendations')).toHaveAttribute('data-recommendation-view', 'shortlist');
    await page.getByTestId('button-change-answers').click();
    await expect(page.getByTestId('option-10000-15000')).toHaveAttribute('aria-pressed', 'true');
  });
}

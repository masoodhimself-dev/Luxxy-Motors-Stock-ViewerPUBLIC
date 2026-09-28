import { test, expect } from '@playwright/test';
for (const width of [390, 1280]) {
  test(`guided dealership setup and public settings at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    let settings = await (await request.get('/api/dealer-settings')).json();
    let writes = 0;
    await page.route('**/api/dealer-settings', async route => {
      if (route.request().method() === 'PATCH') { settings = route.request().postDataJSON(); writes++; }
      await route.fulfill({ json: settings });
    });
    await page.route('https://images.example.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#365366"/></svg>' }));
    await page.goto('/portal');
    await expect(page.getByTestId('input-identity-name')).toBeVisible();
    await page.getByTestId('input-identity-name').fill('Example Motors');
    await page.getByTestId('input-identity-logo-text').fill('Example Motors');
    await page.getByTestId('input-footerLogoUrl').fill('https://images.example.test/logo.svg');
    await page.screenshot({ path: `/tmp/onboarding-${width}-brand.png` });
    await page.getByTestId('button-settings-nav-homepage').click();
    await page.getByTestId('input-hero-copy').fill('A better journey starts here');
    await page.getByTestId('button-settings-nav-presentation').click();
    await page.getByTestId('input-hero-image-url').fill('https://images.example.test/hero.svg');
    await page.getByTestId('input-hero-image-alt').fill('Example forecourt');
    await page.getByTestId('input-contact-image-url').fill('https://images.example.test/contact.svg');
    await page.getByTestId('input-contact-image-alt').fill('Example entrance');
    await page.getByTestId('button-settings-nav-pages').click();
    await page.getByRole('textbox', { name: 'Find a page or phrase' }).fill('stock');
    await page.getByTestId('input-copy-stockTitle').fill('Explore our cars');
    await page.getByTestId('input-copy-stockIntroduction').fill('Choose your next used car.');
    await page.getByTestId('input-copy-stockTitle').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/onboarding-${width}-pages.png` });
    expect(writes).toBe(0);
    await page.getByTestId('button-settings-nav-identity').click();
    await expect(page.getByTestId('input-identity-name')).toHaveValue('Example Motors');
    await page.getByTestId('button-save-settings').click();
    await expect(page.getByRole('heading', { name: 'Review your website', exact: true })).toBeVisible();
    expect(writes).toBe(0);
    await page.getByTestId('button-save-settings').click();
    await expect(page.getByTestId('status-settings-success')).toBeVisible();
    expect(writes).toBe(1);
    expect(settings.presentation.websiteCopy.stockTitle).toBe('Explore our cars');
    expect(settings.presentation.contactImageAlt).toBe('Example entrance');
    await page.goto('/stock');
    await expect(page.getByRole('heading', { name: 'Explore our cars', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.goto('/contact');
    await expect(page.getByAltText('Example entrance')).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'A better journey starts here' })).toBeVisible();
    await expect(page.getByAltText('Example forecourt')).toBeVisible();
    await page.goto('/portal');
    await page.getByTestId('input-footerLogoUrl').fill('javascript:alert(1)');
    await page.getByTestId('button-save-settings').click();
    await expect(page.getByTestId('status-settings-validation')).toBeVisible();
    expect(writes).toBe(1);
  });
}

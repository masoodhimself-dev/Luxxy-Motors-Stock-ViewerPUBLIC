import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Uses synthetic local preview data only.');

for (const width of [390, 1440]) {
  test(`customer review and confirmation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    // Exercise the real API snapshot shape, rather than only the legacy preview shape.
    await page.route('**/api/signing/sample', async route => {
      const response = await route.fetch();
      const data = await response.json();
      data.revision.snapshot.vehicle.title = data.revision.snapshot.vehicle.value;
      delete data.revision.snapshot.vehicle.value;
      data.revision.snapshot.customer = data.revision.snapshot.details;
      delete data.revision.snapshot.details;
      data.revision.snapshot.terms = { disclosureNotes: 'Sample disclosure supplied by the dealer.' };
      await route.fulfill({ json: data });
    });
    let submission: unknown;
    await page.route('**/api/signing/sample/complete', async route => {
      submission = route.request().postDataJSON();
      await route.fulfill({ json: { success: true, developmentOnly: true } });
    });
    await page.goto('/sign/sample');
    await expect(page.getByRole('img', { name: '2018 Mercedes-Benz E Class' })).toBeVisible();
    await expect(page.getByText('Agreed deposit', { exact: true })).toBeVisible();
    await expect(page.getByText('Deposit paid', { exact: true })).toHaveCount(0);
    await expect(page.getByText('customer1@example.com', { exact: true })).toBeVisible();
    await expect(page.getByText('Sample disclosure supplied by the dealer.')).toBeVisible();
    await page.getByRole('link', { name: 'Request a correction' }).click();
    await expect(page.getByRole('heading', { name: 'Something incorrect?' })).toBeFocused();
    const pack = page.getByRole('region', { name: 'Your documents' });
    const agreement = page.getByRole('heading', { name: 'Agreement', exact: true });
    expect((await agreement.boundingBox())!.y).toBeGreaterThan((await pack.boundingBox())!.y + (await pack.boundingBox())!.height);
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download document text' }).click();
    expect((await downloaded).suggestedFilename()).toBe('purchase-documents-revision-1.txt');
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('button', { name: 'Sign and agree' })).toBeHidden();
    await expect(page.getByTestId('signing-document-content')).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
    const directory = resolve('../../docs/screenshots/customer-purchase');
    await mkdir(directory, { recursive: true });
    await page.getByRole('heading', { level: 1 }).click();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: resolve(directory, `review-${width}.png`), fullPage: true });
    await page.getByRole('checkbox').check();
    await page.getByRole('textbox', { name: 'Signer name' }).fill('Amelia Clarke');
    await page.getByRole('textbox', { name: 'Signer email' }).fill('customer1@example.com');
    await page.getByRole('button', { name: 'Sign and agree' }).click();
    await expect(page.getByTestId('signing-receipt')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Development signature recorded' })).toBeFocused();
    expect(submission).toEqual({ signerName: 'Amelia Clarke', signerEmail: 'customer1@example.com', acceptedCodes: ['vehicle'] });
    await expect(page.getByRole('button', { name: 'Sign and agree' })).toHaveCount(0);
    await expect(page.getByTestId('signing-document-content')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download document text' })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByRole('heading', { level: 1 }).click();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: resolve(directory, `confirmation-${width}.png`), fullPage: true });
  });
}

test('missing stock photo and unavailable documents remain honest', async ({ page }) => {
  await page.route('**/api/signing/sample', async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.revision.snapshot.vehicle.id = 'not-public';
    data.revision.documents = [];
    await route.fulfill({ json: data });
  });
  await page.goto('/sign/sample');
  await expect(page.getByRole('heading', { name: 'Your purchase', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '2018 Mercedes-Benz E Class' })).toHaveCount(0);
  await expect(page.getByText('No documents were supplied with this pack. Contact the dealer before agreeing.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download document text' })).toBeDisabled();
});

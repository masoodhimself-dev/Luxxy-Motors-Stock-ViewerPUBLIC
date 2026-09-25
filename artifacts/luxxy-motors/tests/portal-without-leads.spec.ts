import { expect, test } from '@playwright/test';
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local fixtures only');
for (const width of [390, 1440]) {
  test(`portal has no lead system at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const calls: string[] = [];
    page.on('request', request => { if (/\/api\/(leads|portal\/worklist)/.test(request.url())) calls.push(request.url()); });
    await page.goto('/portal');
    await expect(page.getByTestId('input-identity-name')).toBeVisible();
    for (const id of ['tab-today', 'tab-leads', 'tab-channels', 'button-new-lead']) await expect(page.getByTestId(id)).toHaveCount(0);
    await page.getByTestId('tab-reservations').click();
    await expect(page.getByRole('button', { name: 'Open lead', exact: true })).toHaveCount(0);
    await page.goto('/portal/leads/sample-lead-1');
    await expect(page.getByTestId('input-identity-name')).toBeVisible();
    await expect(page.getByTestId('lead-detail')).toHaveCount(0);
    expect(calls).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

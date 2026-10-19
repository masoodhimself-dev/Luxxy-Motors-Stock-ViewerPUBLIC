import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // These checks exercise navigation and layout, never saved application data.
  await page.route('**/api/**', route =>
    ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort(),
  );
});

for (const width of [1440, 820, 390, 320]) {
  test(`staff navigation and quick actions remain reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const section of ['notifications', 'inventory', 'sales', 'reservations', 'history', 'settings']) {
      await page.goto(`/portal?section=${section}`, { waitUntil: 'domcontentloaded' });
      const current = page.getByTestId(`tab-${section}`);
      await expect(current).toHaveAttribute('aria-current', 'page');
      await expect.poll(() => current.evaluate(element => {
        const item = element.getBoundingClientRect();
        const navigation = element.closest('nav')!.getBoundingClientRect();
        return item.left >= navigation.left - 1 && item.right <= navigation.right + 1;
      })).toBe(true);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    const quickActions = page.getByRole('button', { name: 'Quick actions', exact: true });
    await quickActions.click();
    await expect(page.getByRole('menuitem', { name: 'Calendar', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(quickActions).toBeFocused();
    await quickActions.click();
    await page.getByRole('menuitem', { name: 'Calendar', exact: true }).click();
    await expect(page).toHaveURL(/deskView=calendar/);
    await expect(page.getByTestId('tab-notifications')).toHaveAttribute('aria-current', 'page');
  });

  test(`a denied account with a long email remains contained at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/portal/session', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: 'forbidden', email: 'fictional.staff.with.a.very.long.address@example.test' }),
    }));
    await page.goto('/portal', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Access unavailable' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Portal sections', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to showroom', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

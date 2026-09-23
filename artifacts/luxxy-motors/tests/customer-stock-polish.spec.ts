import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Uses archived local stock only.');
for (const width of [390, 1440]) {
  test(`vehicle buyer journey at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/vehicle/preview-1');
    await page.getByRole('link', { name: 'History, MOT, keys & warranty' }).click();
    await expect(page.getByRole('heading', { name: 'What to know about this car' })).toBeFocused();
    await expect(page.getByText('2 keys', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View gallery fullscreen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Interior', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Interior', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.getByRole('link', { name: 'Ask a question', exact: true }).click();
    await expect(page).toHaveURL(/vehicleId=preview-1/);
    const message = page.getByTestId('textarea-enquiry-message');
    await message.fill('I would like to visit on Saturday.');
    await page.getByTestId('enquiry-question-prompts').getByRole('button', { name: 'Service history' }).click();
    await expect(message).toHaveValue('I would like to visit on Saturday.\n\nCould you tell me about the service history and available records?');
    await expect(page.getByTestId('enquiry-question-prompts').getByRole('button', { name: 'Service history' })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const directory = resolve('../../docs/screenshots/customer-stock-polish');
    await mkdir(directory, { recursive: true });
    for (const [name, url] of [['home', '/'], ['vehicle', '/vehicle/preview-1']]) {
      await page.goto(url);
      await expect(page.locator('h1')).toBeVisible();
      await page.evaluate(async () => {
        const imgs = Array.from(document.images);
        imgs.forEach(img => { img.loading = 'eager'; });
        await Promise.race([Promise.all(imgs.map(img => img.decode().catch(() => undefined))), new Promise(resolve => setTimeout(resolve, 5000))]);
        window.scrollTo({ top: 0, behavior: 'instant' });
      });
      await page.screenshot({ path: resolve(directory, `${name}-${width}.png`), fullPage: true });
    }
  });
}
test('vertical scrolling does not change the car photograph', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/vehicle/preview-1');
  const imageButton = page.getByRole('button', { name: 'View gallery fullscreen' });
  const image = imageButton.locator('..').locator('img').first();
  const original = await image.getAttribute('src');
  const swipe = async (end: { x: number; y: number }) => imageButton.evaluate((element, end) => {
    const start = new Touch({ identifier: 1, target: element, clientX: 300, clientY: 300 });
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start], changedTouches: [start] }));
    const finish = new Touch({ identifier: 1, target: element, clientX: end.x, clientY: end.y });
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [finish] }));
  }, end);
  await swipe({ x: 230, y: 500 });
  await expect(image).toHaveAttribute('src', original!);
  await swipe({ x: 100, y: 310 });
  await expect(image).not.toHaveAttribute('src', original!);
  await imageButton.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
for (const width of [320, 390, 1440]) {
  test(`vehicle buying guide works at ${width}px`, async ({page})=>{
    await page.setViewportSize({width,height:900});
    await page.goto('/vehicle/preview-2');
    await expect(page.getByRole('heading',{name:'What you should know',exact:true})).toBeVisible();
    await expect(page.getByRole('paragraph').filter({hasText: /^Category S recorded$/})).toBeVisible();
    const video=page.getByRole('link',{name:'Request a walkaround video'});
    const text=new URL((await video.getAttribute('href'))!).searchParams.get('text');
    expect(text).toContain('walkaround video');
    await page.getByRole('button',{name:'View gallery fullscreen'}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const panel=page.locator('[data-vehicle-contact="booking"]');
    await panel.scrollIntoViewIfNeeded();
    if(width<1024) await expect(page.getByTestId('mobile-conversion-bar')).toHaveCount(0);
    const terms=page.getByText(/reservation deposit · How it works/);
    await terms.click();
    await expect(page.getByRole('heading',{name:'Reservation & cancellation terms'})).toBeVisible();
    await terms.click();
    await page.getByRole('heading',{name:'See it for yourself.'}).scrollIntoViewIfNeeded();
    if(width<1024) await expect(page.getByTestId('mobile-conversion-bar')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await mkdir(resolve('../../docs/screenshots/vehicle-buying-guide'),{recursive:true});
    await page.evaluate(()=>window.scrollTo(0,0));
    await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
    await page.screenshot({path:resolve(`../../docs/screenshots/vehicle-buying-guide/vehicle-${width}-viewport.png`)});
    await page.screenshot({path:resolve(`../../docs/screenshots/vehicle-buying-guide/vehicle-${width}.png`),fullPage:true});
    await page.getByTestId('vehicle-exchange-plate-input').fill('AB12 CDE');
    await page.getByLabel('Approximate mileage').fill('45000');
    await page.getByRole('button',{name:'Continue with my part exchange'}).click();
    await expect(page).toHaveURL(/enquire\?type=general&vehicleId=preview-2/);
    await expect(page.getByTestId('enquiry-part-exchange-plate-input')).toHaveValue('AB12 CDE');
    await expect(page.getByLabel('Current mileage (miles)')).toHaveValue('45000');
  });
}

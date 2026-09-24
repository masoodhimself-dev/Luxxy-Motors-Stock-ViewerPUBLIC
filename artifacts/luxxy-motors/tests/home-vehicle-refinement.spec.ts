import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Read-only archived local preview.');
for (const width of [390, 1440]) {
  test(`quieter homepage and vehicle journey at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 1000});
    await page.goto('/');
    const card = page.getByTestId('card-vehicle-preview-1');
    await expect(card.getByRole('link', {name: 'View vehicle', exact:true})).toBeVisible();
    await expect(card.getByRole('link', {name: /Book a viewing|Call about|WhatsApp about/i})).toHaveCount(0);
    await expect(page.getByRole('heading', {name:'Plan your visit'})).toBeVisible();
    await page.getByTestId('button-header-all-stock').click();
    await expect(page.getByRole('heading', {name:'All stock',exact:true})).toBeFocused();
    await expect(page.locator('[data-testid^="card-vehicle-"]')).toHaveCount(6);
    await page.goto('/vehicle/preview-1');
    await expect(page.getByRole('button',{name:/^Show photograph/})).toHaveCount(6);
    await expect(page.getByRole('paragraph').filter({hasText:/^Category S recorded$/})).toBeVisible();
    if(width === 1440) {
      await page.getByRole('heading',{name:'What to know about this car'}).scrollIntoViewIfNeeded();
      const panel = page.getByTestId('desktop-purchase-panel');
      await expect(panel.getByRole('link',{name:'Ask a question',exact:true})).toBeInViewport();
      expect(await panel.evaluate(el => getComputedStyle(el).position)).toBe('sticky');
    }
    await page.goto('/vehicle/preview-2');
    await page.getByRole('link', {name:'Ask about mot expiry',exact:true}).click();
    await expect(page).toHaveURL(/vehicleId=preview-2&question=mot/);
    await expect(page.getByTestId('textarea-enquiry-message')).toHaveValue(/MOT expiry/);
    await page.getByTestId('textarea-enquiry-message').fill('My own question about the MOT.');
    await expect(page.getByTestId('textarea-enquiry-message')).toHaveValue('My own question about the MOT.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const folder=resolve('../../docs/screenshots/home-vehicle-refinement'); await mkdir(folder,{recursive:true});
    for(const [name,url] of [['home','/'],['vehicle','/vehicle/preview-1']]) {
      if (name === 'home') await page.evaluate(() => sessionStorage.removeItem('luxxy.browse.v1'));
      await page.goto(url); await expect(page.locator('h1')).toBeVisible();
      await page.evaluate(async()=>{const images=Array.from(document.images); images.forEach(i=>i.loading='eager'); await Promise.race([Promise.all(images.map(i=>i.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,5000))]); window.scrollTo({top:0,behavior:'instant'});});
      await page.screenshot({path:resolve(folder,`${name}-${width}.png`),fullPage:true});
      await page.screenshot({path:resolve(folder,`${name}-${width}-viewport.png`)});
    }
  });
}

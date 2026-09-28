import { test, expect } from '@playwright/test';
for (const width of [390,1280]) test(`homepage visual rhythm ${width}`, async ({page}) => {
 await page.setViewportSize({width,height:900});
 await page.goto('/');
 await expect(page.getByRole('form',{name:'Search used cars'})).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:`/tmp/home-art-${width}.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

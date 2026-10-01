import {test,expect} from '@playwright/test';
for(const width of [390,1024,1920]) test(`vehicle width and readability ${width}`,async({page,request})=>{
 await page.setViewportSize({width,height:1080});
 const stock=await(await request.get('/api/stock')).json();
 await page.goto(`/vehicle/${stock.cars[0].id}`);
 await expect(page.locator('.vehicle-summary')).toBeVisible();
 const main=await page.locator('.vehicle-page > .container').boundingBox();
 expect(main!.width).toBeGreaterThan(width*.95);
 await expect(page.locator('.vehicle-editorial-overview p').first()).toHaveCSS('font-size','16px');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:`/tmp/vehicle-readable-${width}.png`});
});

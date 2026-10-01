import {test, expect} from '@playwright/test';
for (const width of [390,1280]) test(`updated stock and reduction at ${width}`, async ({page,request}) => {
 await page.setViewportSize({width,height:900});
 const stock=await (await request.get('/api/stock')).json();
 expect(stock.cars).toHaveLength(9);
 const juke=stock.cars.find((car:any)=>car.advertId==='202609206212316');
 expect(juke.price).toBe(3975);
 expect(stock.cars.some((car:any)=>car.advertId==='202609306547596')).toBe(true);
 await page.goto('/stock');
 await expect(page.getByTestId('price-reduction')).toContainText('Save £200');
 await page.goto(`/vehicle/${juke.id}`);
 await expect(page.getByTestId('price-reduction')).toContainText('£4,175');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:`/tmp/stock-reduction-${width}.png`});
});

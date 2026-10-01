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
 if(width>=1024){
  const placement=await page.evaluate(()=>{
   const gallery=document.querySelector('.vehicle-detail-gallery')!.getBoundingClientRect();
   const about=document.querySelector('[aria-labelledby="vehicle-description-heading"]')!.getBoundingClientRect();
   const features=document.querySelector('[aria-labelledby="features-heading"]')!.getBoundingClientRect();
   const summary=document.querySelector('.vehicle-summary')!.getBoundingClientRect();
   return {gap:about.top-gallery.bottom,featuresGap:features.top-about.bottom,descriptionTop:about.top,summaryBottom:summary.bottom};
  });
  expect(placement.gap).toBeGreaterThanOrEqual(0);
  expect(placement.gap).toBeLessThan(70);
  expect(placement.featuresGap).toBeLessThan(80);
  expect(placement.descriptionTop).toBeLessThan(placement.summaryBottom);
 }
 await page.screenshot({path:`/tmp/vehicle-placement-${width}.png`});
});

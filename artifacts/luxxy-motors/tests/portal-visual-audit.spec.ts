import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
test.skip(process.env.LUXXY_LOCAL_PREVIEW!=='1','Local read-only portal audit.');
for(const width of [390,834,1440])test(`portal visual audit at ${width}`,async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:1000});
 const errors:string[]=[],writes:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',r=>{if(['GET','HEAD'].includes(r.request().method()))return r.continue();writes.push(r.request().url());return r.abort();});
 await mkdir('/tmp/luxxy-portal-visual',{recursive:true});
 for(const section of ['notifications','inventory','sales','reservations','history','settings']){
  await page.goto(`/portal?section=${section}`);await expect(page.locator(`#portal-content-${section}`)).toBeVisible();
  await expect(page.getByText('Loading page…',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${section} overflow`).toBe(true);
  if(section==='inventory'){
   await expect(page.locator('.inventory-car').first()).toBeVisible();
   await expect(page.getByText('Preparation',{exact:true})).toHaveCount(0);
   await expect(page.getByRole('progressbar')).toHaveCount(0);
   await page.screenshot({path:`/tmp/luxxy-portal-visual/cars-${width}.png`,fullPage:true});
   await page.locator('.inventory-car-open').first().click();
   await expect(page.getByRole('group',{name:'Car detail sections'})).toBeVisible();
   await expect(page.getByRole('heading',{name:'Private photos',exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Description',exact:true}).click();
   await expect(page.locator('.inventory-private-photos')).not.toBeVisible();
   await page.getByRole('button',{name:'Customers',exact:true}).click();
   await expect(page.getByRole('heading',{name:'Message a customer',exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Photos & video',exact:true}).click();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:`/tmp/luxxy-portal-visual/car-details-${width}.png`,fullPage:true});
  }else await page.screenshot({path:`/tmp/luxxy-portal-visual/${section}-${width}.png`,fullPage:true});
 }
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});

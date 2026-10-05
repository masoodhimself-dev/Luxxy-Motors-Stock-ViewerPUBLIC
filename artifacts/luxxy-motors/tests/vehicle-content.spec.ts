import {test,expect} from '@playwright/test';
test('enriched descriptions appear while heading-only equipment stays hidden',async({page,request})=>{
 const stock=await(await request.get('/api/stock')).json();
 const focus=stock.cars.find((c:any)=>c.make==='Ford');
 await page.goto(`/vehicle/${focus.id}`);
 await expect(page.locator('#vehicle-description-heading')).toBeVisible();
 await expect(page.locator('section[aria-labelledby="vehicle-description-heading"]').getByText(focus.sourceExtras.advertDescription.trim(),{exact:true})).toBeVisible();
 await expect(page.getByText('Please note:',{exact:true})).toHaveCount(0);
 const mini=stock.cars.find((c:any)=>c.make==='MINI');
 await page.goto(`/vehicle/${mini.id}`);
 await expect(page.getByText('Valuable features',{exact:true})).toHaveCount(0);
 await expect(page.locator('#vehicle-description-heading')).toBeVisible();
});
for (const width of [390,1280]) test(`description deep link and navigation at ${width}`,async({page,request})=>{
 await page.setViewportSize({width,height:900});
 const stock=await(await request.get('/api/stock')).json();
 const focus=stock.cars.find((c:any)=>c.make==='Ford');
 await page.goto(`/vehicle/${focus.id}#vehicle-description-heading`);
 await expect.poll(async()=>page.locator('#vehicle-description-heading').evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(300);
 await page.evaluate(()=>window.scrollTo(0,0));
 const navigation=page.getByRole('navigation',{name:'Vehicle information sections',exact:true});
 await expect(navigation).toHaveCount(1);
 await navigation.getByRole('link',{name:'Features & equipment',exact:true}).click();
 await expect(page.locator('#features-heading')).toBeInViewport();
 await navigation.getByRole('link',{name:'Description',exact:true}).click();
 await expect(page.locator('#vehicle-description-heading')).toBeInViewport();
 const sections=await page.locator('#features-heading, #buyer-information-heading, #vehicle-enquiry-heading').evaluateAll(els=>Object.fromEntries(els.map(el=>[el.id,el.getBoundingClientRect().top])));
 expect(sections['features-heading']).toBeLessThan(sections['buyer-information-heading']);
 expect(sections['buyer-information-heading']).toBeLessThan(sections['vehicle-enquiry-heading']);
 await page.screenshot({path:`/tmp/vehicle-architecture-${width}.png`,fullPage:true});
 await page.locator('.vehicle-equipment-more summary').click();
 await expect(page.locator('.vehicle-equipment-more')).toHaveAttribute('open','');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

for (const width of [390, 1024, 1440]) test(`vehicle content remains unobstructed while scrolling at ${width}`, async ({page, request}) => {
 await page.setViewportSize({width, height:960});
 const stock=await(await request.get('/api/stock')).json();
 const car=stock.cars.find((c:any)=>c.make==='Ford');
 await page.goto(`/vehicle/${car.id}#vehicle-description-heading`);
 const description=page.locator('#vehicle-description-heading');
 await expect(description).toBeInViewport();
 // Visibility alone passes even when a sticky sibling paints over the text.
 for (const id of ['vehicle-description-heading','features-heading','buyer-information-heading','vehicle-visit-heading','vehicle-enquiry-heading']) {
  const heading=page.locator(`#${id}`);
  await heading.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
  await expect.poll(async()=>heading.evaluate(el=>{
   const box=el.getBoundingClientRect();
   const hit=document.elementFromPoint(box.left+Math.min(30,box.width/2),box.top+box.height/2);
   return !!hit && (el===hit || el.contains(hit));
  })).toBe(true);
  const gap=await page.evaluate((headingId)=>{
   const gallery=document.querySelector('.vehicle-detail-gallery')!.getBoundingClientRect();
   const section=document.getElementById(headingId)!.getBoundingClientRect();
   return section.top-gallery.bottom;
  },id);
  expect(gap).toBeGreaterThan(0);
  if(id==='vehicle-description-heading'||id==='features-heading') await page.screenshot({path:`/tmp/vehicle-repaired-${width}-${id}.png`});
 }
 await page.locator('.vehicle-equipment-more summary').click();
 await expect(page.locator('.vehicle-equipment-more')).toHaveAttribute('open','');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

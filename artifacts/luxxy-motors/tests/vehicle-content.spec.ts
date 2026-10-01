import {test,expect} from '@playwright/test';
test('enriched descriptions appear while heading-only equipment stays hidden',async({page,request})=>{
 const stock=await(await request.get('/api/stock')).json();
 const focus=stock.cars.find((c:any)=>c.make==='Ford');
 await page.goto(`/vehicle/${focus.id}`);
 await expect(page.locator('#vehicle-description-heading')).toBeVisible();
 await expect(page.getByText(focus.sourceExtras.advertDescription.trim(),{exact:true})).toBeVisible();
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
 await page.getByRole('link',{name:'Features & equipment',exact:true}).click();
 await expect(page.locator('#features-heading')).toBeInViewport();
 await page.getByRole('link',{name:'Description',exact:true}).click();
 await expect(page.locator('#vehicle-description-heading')).toBeInViewport();
});

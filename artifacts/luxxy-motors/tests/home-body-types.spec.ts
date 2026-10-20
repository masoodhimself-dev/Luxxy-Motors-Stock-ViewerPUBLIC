import {test,expect} from '@playwright/test';
for(const width of [390,820,1440])test(`homepage browsing and body-type filtering at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});
 await page.goto('/');
 const section=page.getByRole('region',{name:'Browse cars',exact:true});await expect(section).toBeVisible();await section.scrollIntoViewIfNeeded();
 await expect(section.getByText('A few good places to start.')).toHaveCount(0);
 const links=section.getByRole('navigation',{name:'Browse by body type'}).getByRole('link');
 expect(await links.count()).toBeGreaterThan(0);
 for(const link of await links.all()){const box=await link.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:`../../output/home-body-types/home-${width}.png`});
 const href=await links.first().getAttribute('href');const selected=new URL(href!,'http://localhost').searchParams.get('bodyType')!;
 const stock=await (await page.request.get('/api/stock')).json();
 const key=(value:string)=>value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const expected=stock.cars.filter((car:any)=>!['sold','archived','hidden'].includes(String(car.inventoryStatus).toLowerCase())&&key(car.bodyType??'')===key(selected));
 await links.first().click();await expect(page).toHaveURL(/\/stock\?bodyType=/);
 await expect(page.locator('[data-testid^="card-vehicle-"]')).toHaveCount(expected.length);
 await expect(page.getByRole('button',{name:`Remove ${selected} filter`,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Advanced search',exact:true}).click();
 await expect(page.getByLabel('Body type',{exact:true})).toHaveValue(selected);
 await page.getByRole('button',{name:'Reset filters',exact:true}).click();
 await expect(page.getByLabel('Body type',{exact:true})).toHaveValue('');
 expect(new URL(page.url()).searchParams.has('bodyType')).toBe(false);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

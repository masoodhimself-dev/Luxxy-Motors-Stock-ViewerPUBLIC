import {test,expect} from '@playwright/test';
for(const width of [390,1280]) test(`saved details and vehicle booking at ${width}`,async({page,request})=>{
 await page.setViewportSize({width,height:900});
 const stock=await(await request.get('/api/stock')).json();const car=stock.cars[0];
 await page.goto(`/vehicle/${car.id}`);
 await page.getByRole('button',{name:/Save .* to your saved cars/}).click();
 await page.goto('/saved');
 await page.locator('summary').filter({hasText:'More details'}).click();
 await expect(page.getByRole('heading',{name:'About this car'})).toBeVisible();
 await page.getByRole('link',{name:'Book a test drive',exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`vehicleId=${car.id}`));
 await page.goto(`/vehicle/${car.id}`);
 if(width<1024){await page.getByRole('button',{name:'Open navigation menu'}).click();}
 await page.getByRole('button',{name:'Book a test drive',exact:true}).first().click();
 await expect(page).toHaveURL(new RegExp(`type=viewing&vehicleId=${car.id}`));
});

import {test,expect} from '@playwright/test';
for(const width of [390,1280]) test(`fullscreen contact actions at ${width}`,async({page,request})=>{
 await page.setViewportSize({width,height:900});
 const stock=await(await request.get('/api/stock')).json();
 await page.goto(`/vehicle/${stock.cars[0].id}`);
 await page.getByRole('button',{name:'View gallery fullscreen'}).click();
 const gallery=page.getByRole('dialog',{name:'Vehicle image gallery'});
 await expect(gallery.getByRole('button',{name:'Message',exact:true})).toBeInViewport();
 await gallery.getByRole('link',{name:/Show phone number/}).click();
 await expect(page.getByRole('dialog')).toHaveCount(2);
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(1);
 await page.screenshot({path:`/tmp/gallery-contact-${width}.png`});
 await gallery.getByRole('button',{name:'Message',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('#vehicle-enquiry-heading')).toBeInViewport();
 await expect(page.locator('#vehicle-enquiry-heading')).toBeFocused();
});

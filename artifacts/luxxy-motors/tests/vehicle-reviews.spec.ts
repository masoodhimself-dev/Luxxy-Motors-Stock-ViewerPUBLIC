import {test,expect} from '@playwright/test';
for(const width of [390,1280])test(`vehicle reviews ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/vehicle/preview-2');
 const card=page.getByRole('region',{name:'Customer reviews',exact:true});
 await card.scrollIntoViewIfNeeded();
 await expect(card).toContainText('James W.');
 await card.getByRole('button',{name:'Next customer review'}).click();
 await expect(card).toContainText('Daniel M.');
 await card.getByRole('button',{name:'Next customer review'}).click();
 await expect(card).toContainText('Invited');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await card.screenshot({path:`/tmp/vehicle-review-${width}.png`});
});

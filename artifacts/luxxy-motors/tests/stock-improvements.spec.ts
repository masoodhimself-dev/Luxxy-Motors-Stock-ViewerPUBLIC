import { test, expect } from '@playwright/test';
for (const width of [390,1280]) test(`stock search and filters ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/stock?all=1');
 await page.getByTestId('input-showroom-search').fill('automatic under £15k');
 await page.getByTestId('input-showroom-search').press('Enter');
 await expect(page.getByRole('button',{name:'Remove Up to £15,000 filter'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Remove Automatic filter'})).toBeVisible();
 await page.getByRole('button',{name:'Advanced search'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByRole('button',{name:/Show \d+ cars/}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'Reset all'}).click();
 await expect(page.getByRole('heading',{name:'All used cars',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:/Saved cars/})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/stock-improvements-${width}.png`,fullPage:true});
});

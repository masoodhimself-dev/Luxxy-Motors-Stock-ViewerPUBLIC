import {test,expect} from '@playwright/test';
for(const width of [390,820,1440]) test(`VIN and tax guide at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});
 await page.route('**/api/**',route=>['GET','HEAD','OPTIONS'].includes(route.request().method())?route.continue():route.abort());
 await page.goto('/portal?section=sales');await page.getByRole('button',{name:'New invoice',exact:true}).click();
 const vehicle=page.getByRole('combobox',{name:'Vehicle',exact:true});const options=await vehicle.locator('option').evaluateAll(nodes=>nodes.map(n=>(n as HTMLOptionElement).value).filter(Boolean));
 await vehicle.selectOption(options[1]);
 await page.getByLabel(/VIN \/ chassis number/).fill('WVWZZZ1JZXW000001');
 await expect(page.getByLabel('Green slip document number (V5C/2)')).toHaveCount(0);
 await page.getByLabel('Generate a Road Tax guide?').selectOption('yes');
 await page.getByLabel('Green slip document number (V5C/2)').fill('012345678901');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download Road Tax guide'}).click();expect((await download).suggestedFilename()).toBe('road-tax-guide.pdf');
 await expect(page.getByLabel('Green slip document number (V5C/2)')).toHaveValue('');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.getByLabel('Generate a Road Tax guide?').scrollIntoViewIfNeeded();
 await page.screenshot({path:`../../output/sales-vin-tax-guide/form-${width}.png`});
 await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByRole('heading',{name:'Who is buying the car?'})).toBeVisible();
});

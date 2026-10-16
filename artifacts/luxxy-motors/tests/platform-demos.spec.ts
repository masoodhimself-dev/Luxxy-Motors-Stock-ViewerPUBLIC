import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
test.skip(process.env.LUXXY_LOCAL_PREVIEW!=='1','Fictional, intercepted platform APIs only');
for(const width of [390,820,1440])test(`demo setup and reset controls at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});
 const dealer={id:'demo-fictional',name:'Fictional Motors',canonicalOrigin:'https://fictional.demo.example.test',status:'active',stockPlatform:'autotrader',retailerId:'fictional',domains:[],activeKeyCount:0};
 let writes=0;
 await page.route('**/api/platform/**',route=>{const path=new URL(route.request().url()).pathname;if(route.request().method()!=='GET'){writes++;return route.abort();}if(path.endsWith('/onboarding-keys'))return route.fulfill({json:{keys:[]}});if(path.endsWith('/demo-config'))return route.fulfill({json:{configured:true,domain:'demo.example.test',emailDomain:'mail.example.test',emailReady:false,recipients:['operator@example.test']}});if(path.endsWith('/workspace'))return route.fulfill({json:{dealer,domains:[],members:[],imports:[],keys:[]}});if(path.endsWith('/demo'))return route.fulfill({json:{demo:true,revision:1,recipient:'operator@example.test',expiresAt:'2026-11-01',baselineSaved:true,sender:'demo-fictional@mail.example.test',emailReady:false}});return route.fulfill({json:{dealers:[dealer],activity:[]}});});
 await page.goto('/platform');await page.getByRole('button',{name:'Demo dealerships',exact:true}).click();
 await page.getByText('Master Bot access',{exact:true}).click();await expect(page.getByRole('button',{name:'Create onboarding credential'})).toBeVisible();await expect(page.getByLabel('Demo dealership name')).toBeVisible();await page.getByLabel('Demo dealership name').fill('Fictional Motors');
 await expect(page.getByText('fictional-motors.demo.example.test',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await mkdir('output/platform-demos',{recursive:true});await page.screenshot({path:`output/platform-demos/create-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Dealerships',exact:true}).click();await page.getByRole('button',{name:/Fictional Motors/}).click();await page.getByRole('tab',{name:'Demo',exact:true}).click();
 await expect(page.getByRole('button',{name:'Restore original demo'})).toBeDisabled();await page.getByLabel('Type demo-fictional to confirm changes').fill('demo-fictional');
 await expect(page.getByRole('button',{name:'Restore original demo'})).toBeEnabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`output/platform-demos/reset-${width}.png`,fullPage:true});expect(writes).toBe(0);
});

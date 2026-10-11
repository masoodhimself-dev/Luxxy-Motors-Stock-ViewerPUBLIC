import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Isolated dashboard checks with mocked platform data');
const dealer = {id:'fictional-dealer',name:'Fictional Motors',status:'draft',canonicalOrigin:'https://fictional.example.test',stockPlatform:'autotrader',retailerId:'fictional',sourceUrl:'https://www.autotrader.co.uk/fictional',domains:[],activeKeyCount:0,latestImport:null,lastSuccessfulImport:null};
for(const width of [390,820,1440]) {
 test(`platform management and onboarding at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:1000});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/platform/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(route.request().method()!=='GET') return route.abort('blockedbyclient');
   if(path.endsWith('/overview')) return route.fulfill({json:{dealers:[dealer],activity:[]}});
   if(path.endsWith('/workspace')) return route.fulfill({json:{dealer,domains:[{hostname:'fictional.example.test',verified:false,verificationToken:'fictional-token'}],members:[],imports:[],keys:[]}});
   return route.fulfill({status:404,json:{error:'Not a mocked endpoint'}});
  });
  await page.goto('/platform');
  await expect(page.getByRole('heading',{name:'Your dealership network'})).toBeVisible();
  await expect(page.getByText('Fictional Motors',{exact:true})).toBeVisible();
  await expect(page.locator('.premium-header')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('output/platform-dashboard',{recursive:true});
  await page.screenshot({path:`output/platform-dashboard/overview-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Dealerships',exact:true}).click();
  await page.getByLabel('Search dealerships').fill('Fictional');
  await page.getByRole('button',{name:/Fictional Motors/}).click();
  await page.getByRole('tab',{name:'Domains'}).click();
  await expect(page.getByText('_dealer-verification.fictional.example.test')).toBeVisible();
  await expect(page.getByText('fictional-token',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Add dealership',exact:true}).first().click();
  await page.getByLabel('Dealership name').fill('Second Fictional Motors');
  await page.getByRole('button',{name:'Continue'}).click();
  await page.getByLabel(/^Website origin/).fill('https://second.example.test');
  await page.getByRole('button',{name:'Continue'}).click();
  await expect(page.getByLabel('Owner account')).toHaveValue('self');
  await page.getByRole('button',{name:'Continue'}).click();
  await page.getByLabel(/^Grok retailer reference/).fill('second-fictional');
  await page.getByLabel('Authorised stock source URL').fill('https://www.autotrader.co.uk/fictional');
  await page.getByRole('button',{name:'Continue'}).click();
  await expect(page.getByRole('button',{name:'Create draft dealership'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:`output/platform-dashboard/onboarding-${width}.png`,fullPage:true});
  expect(errors).toEqual([]);
 });
}

import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const output='/private/tmp/luxxy-postcodes-2026-10-28';
for(const width of [390,820,1440])test(`postcode settings and optional booking journey at ${width}px`,async({page,request})=>{
 await page.setViewportSize({width,height:900});const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const writes:string[]=[];let unavailable=false;
 await page.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!=='http://127.0.0.1:4278')return route.abort();if(url.pathname.startsWith('/api/')&&!['GET','HEAD'].includes(req.method())){writes.push(url.pathname);return route.fulfill({status:403,json:{error:'Test blocks writes.'}});}return route.continue();});
 await page.route('**/api/postcodes?*',route=>unavailable?route.fulfill({status:503,json:{code:'unavailable',error:'Provider unavailable'}}):route.fulfill({json:new URL(route.request().url()).searchParams.has('query')?{postcodes:['HA2 7LU','HA2 7LX']}:{location:{postcode:'HA2 7LU',latitude:51.57,longitude:-0.37,region:'London',administrativeArea:'Harrow'}}}));
 await page.route('**/api/postcodes/distance?*',route=>route.fulfill({json:{miles:3.2,approximate:true}}));
 await page.route('**/api/enquiries/availability?*',route=>{const date=new URL(route.request().url()).searchParams.get('date');return route.fulfill({json:{date,timezone:'Europe/London',slots:[{label:'10:00 am',startAt:`${date}T10:00:00.000Z`,available:true}]}});});
 await page.goto('/portal?section=settings&settingsTab=dealership');const postcode=page.getByRole('combobox',{name:'Postcode',exact:true});await expect(postcode).toBeVisible();await postcode.fill('HA2');await expect(page.getByRole('listbox',{name:'Postcode suggestions'})).toBeVisible();await postcode.press('ArrowDown');await postcode.press('Enter');await expect(postcode).toHaveValue('HA2 7LU');await expect(page.getByText(/Postcode checked/)).toBeVisible();await expect(page.getByRole('textbox',{name:'Street address',exact:true})).toBeEditable();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await postcode.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
 await mkdir(output,{recursive:true});await page.screenshot({path:`${output}/settings-${width}.png`});
 const stock=await(await request.get('/api/stock')).json(),car=stock.cars.find((v:any)=>v.inventoryStatus==='available');
 await page.goto(`/enquire?type=viewing&vehicleId=${car.id}`);await page.getByTestId('group-viewing-slots').getByRole('button').first().click();await page.getByTestId('button-continue-to-details').click();await expect(page.getByTestId('input-customer-name')).toBeVisible();
 await page.getByText('Check distance to the showroom (optional)',{exact:true}).click();const customer=page.getByRole('combobox',{name:'Your postcode (optional)',exact:true});await expect(customer).not.toHaveAttribute('required');await customer.fill('HA2 7LU');await expect(page.getByText(/About 3.2 miles from the dealership/)).toBeVisible();
 await customer.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`${output}/booking-${width}.png`});
 unavailable=true;await customer.fill('SW1A 1AA');await expect(page.getByText(/lookup unavailable/)).toBeVisible();await expect(page.getByTestId('input-customer-name')).toBeEditable();await expect(customer).toHaveValue('SW1A 1AA');expect(writes).toEqual([]);expect(errors).toEqual([]);
});

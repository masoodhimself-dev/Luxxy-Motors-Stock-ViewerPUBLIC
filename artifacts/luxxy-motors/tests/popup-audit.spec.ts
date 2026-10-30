import {test, expect, type Locator, type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
async function fits(page: Page, dialog: Locator) {
 await expect(dialog).toBeVisible();
 await expect.poll(() => dialog.evaluate(el => {
  const r = el.getBoundingClientRect(); return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
 })).toBe(true);
 const close = dialog.getByRole('button',{name:'Close',exact:true});
 const title = dialog.getByRole('heading').first();
 if (await close.count() && await title.count()) {
  const collision = await title.evaluate((el) => {
   const r = document.createRange(); r.selectNodeContents(el);
   const t = r.getBoundingClientRect(), c = el.closest('[role="dialog"]')!.querySelector<HTMLButtonElement>('button[data-popup-close]');
   if (!c) return false;
   const b = c.getBoundingClientRect(); return Math.min(t.right,b.right) - Math.max(t.left,b.left) > 1 && Math.min(t.bottom,b.bottom) - Math.max(t.top,b.top) > 1;
  });
  expect(collision,'Dialog title overlaps its close button').toBe(false);
 }
 await page.keyboard.press('Tab');
 expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
}
test('customer popups, menu, filters, gallery and action dialogs remain usable', async ({page,request},info) => {
 const stock = await (await request.get('/api/stock')).json();
 const settings = await (await request.get('/api/dealer-settings')).json();
 settings.contact = {...settings.contact, phone:'02079460999',whatsapp:'447700900123'};
 settings.hours = [{days:'Monday – Sunday',times:'09:00 – 18:00'}];
 settings.testDriveBooking = {...settings.testDriveBooking, enabled:true};
 settings.delivery = {...settings.delivery,enabled:true};
 settings.deliveryPricing = {enabled:true,basePrice:'50',pricePerMile:'1.50'};
 settings.address = {...settings.address,postcode:'HA2 7LU'};
 const car = {...stock.cars[0],id:stock.cars[0].id,make:'Mercedes-Benz',model:'E Class',title:'Mercedes-Benz E Class',inventoryStatus:'available',vrm:'AB12CDE',plate:'AB12CDE',registration:'AB12CDE',features:['Apple CarPlay','Heated Front Seats','Reversing Camera'],images:Array.from({length:12},(_,i)=>({url:`/src/assets/demo-car-hero.jpg?photo=${i}`,caption:`Photograph ${i+1}`})),heroImage:'/src/assets/demo-car-hero.jpg?photo=0'};
 const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{
  const p = new URL(route.request().url()).pathname;
  if(!['GET','HEAD'].includes(route.request().method())) return route.fulfill({status:405,json:{error:'Read-only popup audit'}});
  if(p==='/api/stock') return route.fulfill({json:{...stock,cars:[car],count:1}});
  if(p==='/api/dealer-settings') return route.fulfill({json:settings});
  if(p==='/api/features') return route.fulfill({json:{features:{publicEnquiries:true,testDriveBookings:true,partExchange:true}}});
  if(p===`/api/vehicles/${car.id}`) return route.fulfill({json:car});
  if(p==='/api/enquiries/availability') { const day = new URL(route.request().url()).searchParams.get('date'); return route.fulfill({json:{date:day,timezone:'Europe/London',slots:[{label:'10:00 am',startAt:`${day}T10:00:00.000Z`,available:true}]}}); }
  if(p.endsWith('/mot-history')) return route.fulfill({json:{status:'available',history:{registration:'AB12CDE',make:'MERCEDES-BENZ',model:'E CLASS',checkedAt:new Date().toISOString(),recall:'Unknown',tests:[{completedDate:'2026-06-01',result:'PASSED',expiryDate:'2027-06-01',mileage:'42000',mileageUnit:'MI',defects:[{type:'ADVISORY',text:'Monitor tyre wear.'}]}]}}});
  if(p.includes('delivery-estimate')) return route.fulfill({json:{postcode:'SW1A 1AA',roadMiles:23.4,basePricePence:5000,pricePerMilePence:150,mileageChargePence:3510,totalPence:8510,distanceBasis:'driving',estimated:true}});
  return route.continue();
 });
 await page.addInitScript(() => {Object.defineProperty(navigator,'share',{configurable:true,value:undefined}); Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{}}});});
 await page.goto(`/vehicle/${car.id}`);
 const help = page.locator('button.customer-term-help').first();
 if(await help.count()) { await help.click(); const tip=page.getByRole('tooltip'); await expect(tip).toBeVisible(); expect((await tip.boundingBox())!.width).toBeLessThanOrEqual(page.viewportSize()!.width); await page.keyboard.press('Escape'); await expect(tip).toHaveCount(0); }
 const openAndClose = async(trigger: Locator, title: RegExp) => {
  await trigger.click(); const dialog = page.getByRole('dialog',{name:title});
  await fits(page,dialog);
  const out = path.resolve('../../../popup-audit-2026-10-30'); await mkdir(out,{recursive:true});
  await page.screenshot({path:path.join(out,`${info.project.name}-${title.source.replace(/[^a-z]/gi,'')}.png`)});
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
 };
 await openAndClose(page.locator('.vehicle-direct-contact').getByRole('link',{name:/Call about/}),/talk about|callback/i);
 await openAndClose(page.locator('.vehicle-direct-contact').getByRole('button',{name:/WhatsApp about/}),/Review your WhatsApp message/);
 await openAndClose(page.getByRole('button',{name:'MOT history',exact:true}),/MOT history/);
 await openAndClose(page.getByRole('button',{name:/Delivery estimate|Delivery · est/}),/Delivery estimate/);
 await page.locator('.vehicle-direct-contact').getByRole('button',{name:/WhatsApp about/}).click();
 const shortDialog = page.getByRole('dialog',{name:'Review your WhatsApp message'});
 const viewport = page.viewportSize()!; await page.setViewportSize({...viewport,height:360});
 await fits(page,shortDialog); await page.keyboard.press('Escape'); await page.setViewportSize(viewport);
 await page.getByTestId(`button-save-${car.id}`).click();
 await page.getByRole('button',{name:'View gallery fullscreen',exact:true}).click();
 const gallery = page.getByRole('dialog',{name:'Vehicle image gallery'}); await fits(page,gallery);
 await page.keyboard.press('ArrowRight'); await page.keyboard.press('Escape'); await expect(gallery).toHaveCount(0);
 await page.goto('/saved');
 await page.getByRole('button',{name:'Share shortlist',exact:true}).click();
 await expect(page.getByText('Shortlist link copied',{exact:true})).toBeVisible();
 await page.getByTestId('button-clear-saved').click();
 const clear = page.getByRole('alertdialog',{name:'Clear your saved cars?'}); await fits(page,clear);
 await clear.getByRole('button',{name:'Keep my cars'}).click(); await expect(clear).toHaveCount(0);
 await expect(page.getByTestId('text-saved-count')).toContainText('1 car');
 await page.goto(`/enquire?type=viewing&vehicleId=${car.id}`);
 await expect(page.getByTestId('select-viewing-date')).toBeVisible();
 await page.getByTestId('group-viewing-slots').getByRole('button').first().click();
 await page.getByTestId('button-continue-to-details').click();
 await expect(page.getByTestId('input-customer-name')).toBeVisible();
 await page.goto('/stock');
 const filter = page.getByRole('button',{name:'Advanced search',exact:true});
 if (await filter.isVisible()) await openAndClose(filter,/Filter used cars/);
 if (info.project.use.viewport!.width < 1024) {
  await page.getByRole('button',{name:'Open navigation menu',exact:true}).click();
  const nav=page.getByRole('navigation',{name:'Mobile navigation'}); await expect(nav).toBeVisible();
  await page.getByRole('button',{name:'Close navigation menu',exact:true}).click(); await expect(nav).toHaveCount(0);
 }
 expect(errors).toEqual([]);
});

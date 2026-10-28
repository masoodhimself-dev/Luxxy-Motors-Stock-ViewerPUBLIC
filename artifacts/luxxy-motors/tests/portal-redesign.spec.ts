import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const output='../../output/portal-makeover-2026-10-28';
for(const width of [390,820,1440]) test(`whole portal desk at ${width}px`,async({page,request})=>{
  await page.setViewportSize({width,height:900});
  const errors:string[]=[],writes:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  const stock=await(await request.get('/api/stock')).json();
  const car=stock.cars.find((car:any)=>!car.inventoryStatus||car.inventoryStatus==='available');
  const names=['Amelia Clarke','James Bennett','Olivia Reed','Thomas Wilson'];
  const entries=names.map((customerName,index)=>({
    id:`10000000-0000-4000-8000-00000000000${index+1}`,reference:`ENQ-PREVIEW-${index+1}`,
    type:index===1?'viewing':'general',status:index===2?'contacted':'new',customerName,
    email:`customer${index+1}@example.test`,phone:'07700900123',preferredContact:'email',
    source:'website',vehicleId:car.id,vehicleTitle:car.title,vehicleRegistration:car.registration||null,
    vehiclePrice:car.price,vehicleUrl:`/vehicle/${car.id}`,
    message:'Could I arrange a viewing, and can you confirm the service history?',
    assignedToId:index===2?'preview-alex':null,assignedToName:index===2?'Alex':null,
    appointmentAt:index===1?new Date(Date.now()+86400000).toISOString():null,
    appointmentStatus:index===1?'confirmed':null,appointmentRevision:0,
    appointmentCancelledAt:null,followUpAt:null,followUpRevision:0,followUpCompletedAt:null,
    workspaceRevision:0,events:[],createdAt:new Date(Date.now()-3600000).toISOString(),updatedAt:new Date().toISOString(),
  }));
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==new URL(test.info().project.use.baseURL!).origin)return route.abort();
    if(url.pathname.startsWith('/api/')&&!['GET','HEAD'].includes(req.method())){writes.push(req.url());return route.fulfill({status:403,json:{error:'Visual review blocks writes.'}});}
    if(url.pathname==='/api/enquiries')return route.fulfill({json:entries});
    if(url.pathname==='/api/test-drive-bookings')return route.fulfill({json:entries.filter(entry=>entry.type==='viewing')});
    if(/\/staff\/enquiries\/[^/]+\/conversations$/.test(url.pathname))return route.fulfill({json:{events:[],total:0,nextCursor:null}});
    return route.continue();
  });
  await mkdir(output,{recursive:true});
  const fits=async()=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const nav=page.getByRole('navigation',{name:'Portal sections'});
  await page.goto('/portal?section=notifications&workView=customers');
  await expect(nav.getByRole('button')).toHaveText(['Inbox','Sales','Settings'],{timeout:20000});
  await expect(page.getByRole('button',{name:/Open enquiry for Amelia/})).toBeVisible();
  if(width<768){for(const button of await nav.getByRole('button').all()){const box=await button.boundingBox();expect(box!.y+box!.height).toBeLessThanOrEqual(900);expect(box!.y).toBeGreaterThan(800);}}
  await page.getByRole('button',{name:/Open enquiry for Amelia/}).click();
  await expect(page.getByRole('region',{name:'Selected enquiry: Amelia Clarke'})).toBeVisible();
  await fits();
  await page.screenshot({path:`${output}/inbox-${width}.png`,fullPage:false});
  await page.getByRole('button',{name:'Vehicle information',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  if(width<900)await page.getByRole('button',{name:'Back to enquiries',exact:true}).click();
  await page.getByRole('textbox',{name:'Find a customer or car'}).fill('James');
  await expect(page.getByRole('button',{name:/Open enquiry for James/})).toBeVisible();
  await expect(page.getByRole('button',{name:/Open enquiry for Amelia/})).toHaveCount(0);
  await page.getByRole('textbox',{name:'Find a customer or car'}).fill('');
  await page.getByRole('button',{name:'Quick enquiry',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();await fits();await page.keyboard.press('Escape');
  await page.getByRole('navigation',{name:'Notifications views'}).getByRole('button',{name:'Test drives',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Test-drive appointments',exact:true})).toBeVisible();await fits();
  await page.screenshot({path:`${output}/bookings-${width}.png`,fullPage:false});
  await page.getByRole('navigation',{name:'Notifications views'}).getByRole('button',{name:'Email records',exact:true}).click();
  await expect(page.getByRole('group',{name:'Email views'})).toBeVisible();await fits();
  await page.screenshot({path:`${output}/email-${width}.png`,fullPage:false});
  await nav.getByRole('button',{name:'Sales',exact:true}).click();
  await expect(page.getByRole('button',{name:'New invoice',exact:true})).toBeVisible();await fits();
  await page.screenshot({path:`${output}/sales-${width}.png`,fullPage:false});
  await page.getByRole('button',{name:'New invoice',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Which car are you selling?'})).toBeVisible();await fits();
  await page.screenshot({path:`${output}/invoice-${width}.png`,fullPage:false});
  const footer=page.locator('.invoice-builder-footer');await footer.scrollIntoViewIfNeeded();
  if(width<768){const fb=await footer.boundingBox(),nb=await nav.boundingBox();expect(fb!.y+fb!.height).toBeLessThanOrEqual(nb!.y+1);}
  await page.goto('/portal?section=settings');
  const categories=page.getByRole('tablist',{name:'Settings categories'});
  await expect(categories.getByRole('tab')).toHaveCount(6);
  await categories.getByRole('tab',{name:'Business',exact:true}).focus();
  await page.keyboard.press(width>=1200?'ArrowDown':'ArrowRight');
  await expect(categories.getByRole('tab',{name:'Brand',exact:true})).toBeFocused();
  await expect(categories.getByRole('tab',{name:'Business',exact:true})).toHaveAttribute('aria-selected','true');
  for(const name of ['Business','Brand','Bookings','Invoices & terms','Messages','Team']){
    await categories.getByRole('tab',{name,exact:true}).click();
    await expect(categories.getByRole('tab',{name,exact:true})).toHaveAttribute('aria-selected','true');
    await expect(page.getByRole('tabpanel').first()).toBeVisible();await fits();
  }
  await categories.getByRole('tab',{name:'Business',exact:true}).click();
  await page.getByRole('textbox',{name:'Dealership name',exact:true}).fill('Unsaved local review');
  page.once('dialog',dialog=>dialog.dismiss());
  await nav.getByRole('button',{name:'Sales',exact:true}).click();
  await expect(nav.getByRole('button',{name:'Settings',exact:true})).toHaveAttribute('aria-current','page');
  await page.screenshot({path:`${output}/settings-${width}.png`,fullPage:false});
  expect(writes).toEqual([]);expect(errors).toEqual([]);
});

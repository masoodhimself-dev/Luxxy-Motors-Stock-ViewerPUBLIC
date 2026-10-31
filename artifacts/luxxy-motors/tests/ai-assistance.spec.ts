import {test,expect} from '@playwright/test';
test('AI finder, car answers and equipment fit, with quota and outage fallbacks',async({page,request})=>{
 await page.addInitScript(()=>Object.defineProperty(crypto,'randomUUID',{configurable:true,value:undefined}));
 const stock=await(await request.get('/api/stock')).json();const settings=await(await request.get('/api/dealer-settings')).json();
 const car={...stock.cars[0],make:'Ford',model:'Focus',title:'Ford Focus',inventoryStatus:'available',features:['Heated Front Seats','Parking Sensors'],description:'Full service history. Heated front seats and parking sensors fitted.',sourceExtras:{},specifications:{},heroImage:'/src/assets/demo-car-hero.jpg',images:[{url:'/src/assets/demo-car-hero.jpg'}]};
 let remaining=10;const calls:string[]=[];const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;
  if(path==='/api/ai/status')return route.fulfill({json:{enabled:true,remaining,limit:10}});
  if(path==='/api/ai/assist'){const b=route.request().postDataJSON();calls.push(b.kind);remaining--;return route.fulfill({json:{answer:b.kind==='finder'?'These cars match your request.':b.kind==='explain'?'Heated front seats warm the seat surfaces.':'Full service history is listed. Please confirm the records with the team.',vehicleIds:b.kind==='finder'?[car.id]:[],questions:b.kind==='faqs'?[{question:'What equipment is included?',answer:'Heated front seats and parking sensors are listed.'}]:[],evidence:[car.id],remaining,cached:false}});}
  if(!['GET','HEAD'].includes(route.request().method()))return route.fulfill({status:405,json:{error:'No records may be changed in this audit'}});
  if(path==='/api/stock')return route.fulfill({json:{...stock,cars:[car],count:1}});
  if(path==='/api/dealer-settings')return route.fulfill({json:settings});
  if(path===`/api/vehicles/${car.id}`)return route.fulfill({json:car});
  if(path.endsWith('/mot-history'))return route.fulfill({json:{status:'unavailable'}});
  return route.continue();
 });
 await page.goto('/');await expect(page.getByRole('heading',{name:'Tell us what you’re looking for'})).toBeVisible();
 expect(calls).toHaveLength(0);await page.getByLabel('Describe the car you want').fill('Automatic under £8,000');await page.getByRole('button',{name:'Find me a car',exact:true}).click();
 await expect(page.locator('.ai-matched-cars')).toContainText('Ford Focus');await expect(page.locator('.ai-allowance')).toContainText('9 of 10');
 await page.goto(`/vehicle/${car.id}`);await page.locator('.vehicle-summary').getByRole('link',{name:'Ask a question',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Questions about this Ford Focus'});await expect(dialog).toBeVisible();await expect.poll(()=>calls.filter(c=>c==='faqs').length).toBe(1);

 await dialog.getByRole('textbox',{name:'Search these answers'}).fill('What history does it have?');await dialog.getByRole('button',{name:'Ask AI',exact:true}).click();await expect(dialog.locator('.ai-answer')).toContainText('Full service history is listed');
 const box=await dialog.boundingBox();const view=page.viewportSize()!;expect(box!.x).toBeGreaterThanOrEqual(-1);expect(box!.y).toBeGreaterThanOrEqual(-1);expect(box!.x+box!.width).toBeLessThanOrEqual(view.width+1);expect(box!.y+box!.height).toBeLessThanOrEqual(view.height+1);
 await dialog.getByRole('textbox',{name:'Search these answers'}).fill('keys');await expect(dialog.locator('.ai-answer')).toHaveCount(0);await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'Explain a feature',exact:true}).click();const equipment=page.getByRole('dialog',{name:'Understand this car’s equipment'});await equipment.getByRole('button',{name:'Explain this feature'}).click();await expect(equipment.getByRole('status')).toContainText('warm the seat surfaces');await page.keyboard.press('Escape');
 // Budget/session denial must preserve the saved answers and team contact path.
 await page.route('**/api/ai/assist',route=>route.fulfill({status:429,json:{error:'You’ve used your 10 AI requests for this browser session.',code:'session_limit'}}));
 await page.locator('.vehicle-summary').getByRole('link',{name:'Ask a question',exact:true}).click();await dialog.getByRole('textbox',{name:'Search these answers'}).fill('warranty');await dialog.getByRole('button',{name:'Ask AI',exact:true}).click();await expect(dialog.locator('.ai-answer')).toContainText('10 AI requests');await expect(dialog.getByRole('button',{name:'Ask AI',exact:true})).toBeDisabled();await expect(dialog.getByRole('button',{name:'Ask our team'})).toBeEnabled();await expect(dialog.getByRole('button',{name:'Does this car come with a warranty?'})).toBeVisible();
 await page.keyboard.press('Escape');
 await page.route('**/api/ai/status',route=>route.fulfill({json:{enabled:false,remaining:10,limit:10}}));await page.reload();await page.goto('/');await page.getByLabel('Describe the car you want').fill('Small petrol car');await page.getByRole('button',{name:'Find me a car',exact:true}).click();await expect(page.locator('.ai-car-finder').getByRole('status')).toContainText('stock filters');await expect(page.getByRole('link',{name:'Browse all cars',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);expect(calls).toEqual(['finder','faqs','question','explain']);
});

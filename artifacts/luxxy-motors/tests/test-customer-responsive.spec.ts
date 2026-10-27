import {test,expect} from '@playwright/test';

for(const width of [390,820,1440]) test(`customer forms stay in test mode at ${width}px`,async({page,request})=>{
  const settings=await (await request.get('http://127.0.0.1:4290/api/dealer-settings')).json();
  settings.partExchange={...settings.partExchange,enabled:true};
  settings.testDriveBooking={enabled:true,durationMinutes:30,bufferMinutes:0,minimumNoticeHours:0,dailyCapacity:16,daysAhead:30,blockedDates:[],instructions:'',confirmationMode:'approval',weeklyHours:Array.from({length:7},(_,day)=>({day,enabled:true,open:'09:00',close:'18:00'}))};
  const session={sessionId:'safe-test',expiresAt:'2099-01-01T00:00:00Z',vehicle:{id:'car-copy',title:'Ford Focus',registration:'AB12 CDE',price:5000},customer:{name:'Sample Customer',phone:'07700900123',email:'customer@example.test',address:''}};
  let active=false;let enquiries:any[]=[];const bodies:any[]=[];const badWrites:string[]=[];const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width,height:900});
  await page.route(/^https?:\/\//,route=>new URL(route.request().url()).origin==='http://127.0.0.1:4290'?route.continue():route.abort());
  await page.route('**/api/**',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname,m=req.method();
    if(p==='/api/staff/access')return route.fulfill({json:{role:'owner',permissions:['sales.manage','finance.export','settings.publish'],user:{authUserId:'test-owner',name:'Test Owner'}}});
    if(p==='/api/stock')return route.fulfill({json:{schemaVersion:1,dealerName:'Test dealership',count:2,cars:[{id:'test-car-a',title:'Ford Focus',make:'Ford',model:'Focus',price:5000,images:[],inventoryStatus:'available',fuel:'Petrol',transmission:'Manual'},{id:'test-car-b',title:'BMW 3 Series',make:'BMW',model:'3 Series',price:9000,images:[],inventoryStatus:'available',fuel:'Diesel',transmission:'Automatic'}]}});
    if(p==='/api/sales-test/sessions'&&m==='GET')return route.fulfill({json:{session:active?session:null}});
    if(p==='/api/sales-test/available-vehicles')return route.fulfill({json:{cars:[{id:'real-car',title:'Ford Focus',registration:'AB12 CDE',price:5000}]}});
    if(p==='/api/sales-test/available-customers')return route.fulfill({json:{customers:[{id:'real-customer',source:'customer',name:'Sample Customer',phone:'07700900123',email:'customer@example.test'}]}});
    if(p==='/api/sales-test/sessions'&&m==='POST'){active=true;return route.fulfill({json:session});}
    if(p==='/api/test-email-settings')return route.fulfill({json:{email:'test@example.test'}});
    if(p==='/api/sales-test/sessions/safe-test/settings')return route.fulfill({json:{config:settings,revision:1}});
    if(p==='/api/sales-test/sessions/safe-test/enquiries/availability'){const date=u.searchParams.get('date');return route.fulfill({json:{date,timezone:'Europe/London',slots:[{startAt:`${date}T10:00:00.000Z`,label:'10:00 am',available:true}]}});}
    if(p==='/api/sales-test/sessions/safe-test/enquiries'&&m==='GET')return route.fulfill({json:{enquiries}});
    if(p==='/api/sales-test/sessions/safe-test/enquiries'&&m==='POST'){const body=req.postDataJSON();bodies.push(body);const enquiry={id:`enquiry-${enquiries.length}`,revision:1,type:body.type,vehicleId:body.vehicleId,vehicleTitle:'BMW 3 Series',customerName:body.contact?.name??'Sample Customer',email:body.contact?.email??'',phone:body.contact?.phone??'',message:body.message,partExchange:body.partExchange??null,appointmentAt:body.appointmentAt??null,appointmentStatus:body.appointmentAt?'pending':null};enquiries=[enquiry,...enquiries];return route.fulfill({json:{enquiry,replayed:false}});}
    if(!['GET','HEAD'].includes(m)){badWrites.push(`${m} ${p}`);return route.abort();}
    return route.continue();
  });
  await page.addInitScript(()=>{localStorage.setItem('luxxy.saved-cars.v1','["real-car"]');localStorage.setItem('luxxy.saved-car-snapshots.v1','{"real-car":{"title":"Real"}}');});
  await page.goto('http://127.0.0.1:4290/portal?section=notifications');
  await page.getByRole('button',{name:'More workspace options'}).click();await page.getByRole('menuitem',{name:'Start test mode'}).click();
  await page.getByRole('combobox',{name:'Car'}).selectOption('real-car');await page.getByRole('combobox',{name:'Customer'}).selectOption('customer:real-customer');await page.getByRole('button',{name:'Start test',exact:true}).click();
  await page.getByText('Try customer pages').click();
  const browser=page.getByRole('region',{name:'Customer website test browser'});
  await browser.getByRole('button',{name:'Browse stock',exact:true}).click();await expect(browser.getByRole('heading',{name:'Browse cars'})).toBeVisible();
  await browser.getByRole('button',{name:'Save BMW 3 Series to saved cars'}).click();
  await browser.getByRole('button',{name:'Saved & practice watches (1)'}).click();await expect(browser.getByText('BMW 3 Series')).toBeVisible();
  await browser.getByRole('button',{name:'View',exact:true}).click();await expect(browser.getByRole('button',{name:'Back to stock'})).toBeVisible();
  await browser.getByRole('button',{name:'Practise watching'}).click();await browser.getByLabel('Email address for practice watch').fill('sample@example.test');await browser.getByRole('button',{name:'Practise request'}).click();await browser.getByRole('button',{name:'Simulate confirmation'}).click();
  await browser.getByRole('button',{name:'Saved & practice watches (1)'}).click();await expect(browser.getByText('BMW 3 Series — confirmed')).toBeVisible();
  await browser.getByRole('button',{name:'View',exact:true}).first().click();
  await browser.getByRole('button',{name:'Enquire about this car'}).click();
  await page.getByRole('link',{name:'Back to showroom'}).click();expect(page.url()).toContain('/portal');
  await page.getByTestId('textarea-enquiry-message').fill('A website question');await page.getByTestId('button-submit-enquiry').click();await expect(page.getByText('Test enquiry received')).toBeVisible();
  await page.getByRole('button',{name:'Test drive',exact:true}).click();await page.getByTestId('group-viewing-slots').getByRole('button').first().click();await page.getByTestId('button-continue-to-details').click();await page.getByTestId('button-review-booking').click();await page.getByTestId('button-submit-enquiry').click();await expect(page.getByText('Test drive request saved in the test inbox')).toBeVisible();
  await page.getByRole('button',{name:'Part exchange',exact:true}).click();await page.getByTestId('input-part-exchange-registration').fill('AB12 CDE');await page.getByTestId('input-part-exchange-mileage').fill('45000');await page.getByTestId('button-part-exchange-continue').click();await page.getByTestId('button-part-exchange-continue').click();await page.getByRole('checkbox').check();await page.getByTestId('button-part-exchange-continue').click();await expect(page.getByText('Test part-exchange enquiry received')).toBeVisible();
  expect(enquiries.map(e=>e.type).sort()).toEqual(['general','part_exchange','viewing']);expect(bodies.map(body=>body.vehicleId)).toEqual(['test-car-b','test-car-b','test-car-b']);expect(page.url()).toContain('/portal');expect(badWrites).toEqual([]);expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.evaluate(()=>localStorage.getItem('luxxy.saved-cars.v1'))).toBe('["real-car"]');expect(await page.evaluate(()=>localStorage.getItem('luxxy.saved-car-snapshots.v1'))).toBe('{"real-car":{"title":"Real"}}');
});

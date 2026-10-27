import {test,expect} from '@playwright/test';

for(const width of [390,820,1440]) test(`isolated test enquiry on ${width}px`,async({page})=>{
  const session={sessionId:'safe-test',expiresAt:'2099-01-01T00:00:00Z',vehicle:{id:'car-copy',title:'Ford Focus',registration:'AB12 CDE',price:5000},customer:{name:'Sample customer',phone:'01234567890',email:'customer@example.org',address:''}};
  let active=false; let enquiries:unknown[]=[]; const badWrites:string[]=[]; const errors:string[]=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.setViewportSize({width,height:900});
  await page.route(/^https?:\/\//,route=>new URL(route.request().url()).origin==='http://127.0.0.1:4290'?route.continue():route.abort());
  await page.route('**/api/**',async route=>{
    const request=route.request(), url=new URL(request.url());
    const path=url.pathname, method=request.method();
    if(path==='/api/staff/access') return route.fulfill({json:{role:'owner',permissions:['sales.manage','finance.export','settings.publish'],user:{authUserId:'test-owner',name:'Test Owner'}}});
    if(path==='/api/sales-test/sessions'&&method==='GET')return route.fulfill({json:{session:active?session:null}});
    if(path==='/api/sales-test/available-vehicles')return route.fulfill({json:{cars:[{id:'real-car',title:'Ford Focus',registration:'AB12 CDE',price:5000}]}});
    if(path==='/api/sales-test/available-customers')return route.fulfill({json:{customers:[{id:'real-customer',source:'customer',name:'Sample customer',phone:'01234567890',email:'customer@example.org'}]}});
    if(path==='/api/sales-test/sessions'&&method==='POST'){active=true;return route.fulfill({json:session});}
    if(path==='/api/test-email-settings')return route.fulfill({json:{email:'test@example.org'}});
    if(path==='/api/sales-test/sessions/safe-test/enquiries'&&method==='GET')return route.fulfill({json:{enquiries}});
    if(path==='/api/sales-test/sessions/safe-test/enquiries'&&method==='POST') {enquiries=[{id:'enquiry-copy',revision:1,type:'general',vehicleTitle:'Ford Focus',customerName:'Sample customer',message:'Can I see the car?',appointmentAt:null,appointmentStatus:null}];return route.fulfill({json:{enquiry:enquiries[0],replayed:false}});}
    if(!['GET','HEAD'].includes(method)){badWrites.push(`${method} ${path}`);return route.abort();}
    return route.continue();
  });
  await page.goto('/portal?section=notifications');
  await page.getByRole('button',{name:'More workspace options'}).click();
  await page.getByRole('menuitem',{name:'Start test mode'}).click();
  await page.getByRole('combobox',{name:'Car'}).selectOption('real-car');
  await page.getByRole('combobox',{name:'Customer'}).selectOption('customer:real-customer');
  await page.getByRole('button',{name:'Start test',exact:true}).click();
  await expect(page.getByText('Test mode',{exact:true})).toBeVisible();
  await page.getByLabel('Message',{exact:true}).fill('Can I see the car?');
  await page.getByRole('button',{name:'Create practice enquiry'}).click();
  await expect(page.getByText('Can I see the car?',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(badWrites).toEqual([]);expect(errors).toEqual([]);
});

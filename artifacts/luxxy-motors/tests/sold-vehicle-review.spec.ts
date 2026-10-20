import { test, expect, type Page } from '@playwright/test';
import type { SoldVehicleFollowUpReview } from '../src/lib/sold-vehicle-follow-ups';
const now='2026-10-20T12:00:00Z';
const base: SoldVehicleFollowUpReview={saleId:'fictional-sale',vehicleId:'fictional-yaris',vehicleTitle:'Toyota Yaris',registration:'ZZ20 TST',imageUrl:null,sold:true,createdAt:now,remaining:3,upcomingAppointments:2,customers:[
 {enquiryId:'fictional-alex',customerName:'Alex Morgan',email:'alex.morgan.with.a.long.address@example.test',phone:'07700 900101',preferredContact:'phone',kind:'appointment',appointmentAt:'2026-10-20T15:00:00Z',appointmentRevision:3,appointmentCancelledAt:null,status:'pending',revision:1,cancelledByReview:false,contactedAt:null,outcome:null,emailStatus:null,emailRequestId:'00000000-0000-4000-8000-000000000995',urgent:true,appointments:[{enquiryId:'fictional-alex',at:'2026-10-20T15:00:00Z',revision:3,cancelledAt:null}]},
 {enquiryId:'fictional-jamie',customerName:'Jamie Taylor',email:null,phone:'07700 900102',preferredContact:'phone',kind:'appointment',appointmentAt:'2026-10-21T10:00:00Z',appointmentRevision:1,appointmentCancelledAt:null,status:'pending',revision:1,cancelledByReview:false,contactedAt:null,outcome:null,emailStatus:null,urgent:false,appointments:[{enquiryId:'fictional-jamie',at:'2026-10-21T10:00:00Z',revision:1,cancelledAt:null}]},
 {enquiryId:'fictional-casey',customerName:'Casey Patel',email:'casey@example.test',phone:'07700 900103',preferredContact:'email',kind:'interest',appointmentAt:null,appointmentRevision:0,appointmentCancelledAt:null,status:'pending',revision:1,cancelledByReview:false,contactedAt:null,outcome:null,emailStatus:null,urgent:false,appointments:[]},
]};
const saved={to:'kept-recipient@example.test',subject:'My saved subject',message:'Keep this carefully prepared draft wording.',includeVehicle:false,includeAppointment:false,photoIds:[],documentIds:[],expectedRevision:7};
async function setup(page:Page,options:{saved?:boolean;conflict?:boolean;permissions?:string[];followUpError?:boolean;submitted?:boolean;expired?:boolean}={}){
 let review=structuredClone(base); if(options.expired){const row=review.customers[0];row.appointmentAt='2020-01-01T10:00:00Z';row.appointments?.forEach(a=>{a.at=row.appointmentAt!;});row.urgent=false;review.customers=[row];review.remaining=1;review.upcomingAppointments=0;} if(options.submitted){const row=review.customers[0];row.cancelledByReview=true;row.appointmentCancelledAt=now;row.appointments?.forEach(a=>{a.cancelledAt=now;});row.emailStatus='sent';review.upcomingAppointments--;} const writes:string[]=[],actions:{path:string;body:any}[]=[],errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message)); await page.clock.setFixedTime(new Date(now));
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/staff/sold-vehicle-follow-ups')return options.followUpError?route.fulfill({status:503,json:{error:'Fictional busy response'}}):route.fulfill({json:{tasks:review.remaining?[review]:[],total:review.remaining?1:0,generatedAt:now}});
  if(path==='/api/staff/sold-vehicle-follow-ups/fictional-sale')return route.fulfill({json:review});
  if(path.startsWith('/api/staff/sold-vehicle-follow-ups/fictional-sale/customers/')&&req.method()==='POST'){
   const body=req.postDataJSON();actions.push({path,body}); if(options.conflict)return route.fulfill({status:409,json:{error:'A colleague changed this booking.'}});
   const row=review.customers.find(c=>c.enquiryId===path.split('/').at(-1))!;
   if(body.action==='cancel_appointment'){row.cancelledByReview=true;row.appointmentCancelledAt=now;row.appointmentRevision++;row.appointments?.forEach(a=>{a.cancelledAt=now;a.revision++;});review.upcomingAppointments--;}
   else {row.status=body.outcome==='not_needed'?'not_needed':'contacted';row.outcome=body.outcome;review.remaining--;}
   row.revision++;return route.fulfill({json:review});
  }
  if(!['GET','HEAD'].includes(req.method())){writes.push(`${req.method()} ${path}`);return route.abort();}
  if(path==='/api/staff/stock-change-tasks')return route.fulfill({json:{tasks:[],total:0,generatedAt:now}});
  if(path==='/api/staff/notifications')return route.fulfill({json:{generatedAt:now,emailAccess:true,counts:{enquiries:0,followups:0,appointments:0,drafts:0,email:0},items:[]}});
  if(path==='/api/dealer-operations')return route.fulfill({json:{generatedAt:now,unansweredEnquiries:0,upcomingAppointments:0,pendingAppointments:0,overdueFollowUps:0,outstandingBalancePence:0,salesWithBalance:0,upcomingDeliveries:0,stockCount:2,completedSales:1,totalEnquiries:0,convertedEnquiries:0,enquiryConversionPercent:0,completedConversionPercent:0,stock:{stale:false,lastSuccessfulSync:now,alerts:[]},appointments:[],balances:[],deliveries:[]}});
  if(path==='/api/staff/access')return route.fulfill({json:{role:'owner',permissions:options.permissions??['sales.manage','stock.manage','settings.publish','payments.record'],user:{name:'Fictional staff',email:'staff@example.test'}}});
  if(path==='/api/enquiries')return route.fulfill({json:review.customers.map(c=>({id:c.enquiryId,reference:'INTERNAL-HIDDEN',customerName:c.customerName,email:c.email,phone:c.phone,vehicleId:review.vehicleId,vehicleTitle:review.vehicleTitle,type:c.kind==='appointment'?'viewing':'general',status:'new',message:'Please tell me about this car.',source:'website',workspaceRevision:7,appointmentRevision:c.appointmentRevision,appointmentAt:c.appointmentAt,appointmentCancelledAt:c.appointmentCancelledAt,createdAt:now,updatedAt:now,events:[]}))});
  if(path==='/api/staff/email')return route.fulfill({json:{messages:[],hasMore:false}});
  if(path==='/api/staff/email-drafts')return route.fulfill({json:{drafts:[],hasMore:false}});
  if(path.endsWith('/email-context'))return route.fulfill({json:{version:options.saved?4:0,savedDraft:options.saved?{version:4,status:'draft',content:saved,updatedAt:now}:null,email:review.customers[0].email,customerName:'Alex Morgan',vehicleId:review.vehicleId,vehicleTitle:review.vehicleTitle,reference:'INTERNAL-HIDDEN',revision:7,vehicleAvailable:false,appointmentAvailable:false,defaults:{subject:'Generic subject',message:'Generic message'},ready:true,templates:[],invoices:[],photos:[],deliveries:[]}});
  return route.continue();
 });await page.emulateMedia({reducedMotion:'reduce'});return{writes,actions,errors,review:()=>review};
}
async function noOverflow(page:Page,width:number){expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);}
for(const width of [320,390,820,1440])test(`sold review and approved email remain usable at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});const state=await setup(page);await page.goto('/portal?section=notifications');
 await page.getByRole('button',{name:/Sold car follow-ups 1/}).click();
 await page.getByRole('button',{name:'Review customers',exact:true}).click();
 const region=page.getByRole('region',{name:'Sold car customers',exact:true});await expect(region).toContainText('Alex Morgan');
 await expect(region.getByText('Call before they travel',{exact:true})).toBeVisible();await expect(region).toContainText('No email — contact by phone');
 await expect(page.getByText('You’re up to date',{exact:true})).toHaveCount(0);await noOverflow(page,width);
 await page.screenshot({path:`/tmp/luxxy-sold-review-${width}.png`,fullPage:true});
 await region.getByRole('checkbox',{name:'Select Jamie Taylor for cancellation'}).uncheck();
 await region.getByRole('button',{name:'Cancel selected & prepare emails'}).click();expect(state.actions).toHaveLength(0);
 await region.getByRole('button',{name:'Confirm cancellation of 1 customer’s visits'}).click();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toContainText('we’ve cancelled your test drive');
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toContainText('Toyota Yaris');
 await expect(page.getByRole('button',{name:'Review email',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/Send email/,exact:true})).toHaveCount(0);
 await noOverflow(page,width);await page.screenshot({path:`/tmp/luxxy-sold-email-${width}.png`,fullPage:true});
 expect(state.actions).toHaveLength(1);expect(state.actions[0].body.action).toBe('cancel_appointment');expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
test('existing saved recipient and wording survive the cancellation suggestion',async({page})=>{
 const state=await setup(page,{saved:true});await page.goto('/portal?section=notifications');await page.getByRole('button',{name:'Review customers',exact:true}).click();
 await page.getByRole('checkbox',{name:'Select Jamie Taylor for cancellation'}).uncheck();await page.getByRole('button',{name:'Cancel selected & prepare emails'}).click();await page.getByRole('button',{name:'Confirm cancellation of 1 customer’s visits'}).click();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue(saved.message);await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveValue(saved.subject);
 await expect(page.getByText(/Your saved draft has been kept/)).toBeVisible();await page.getByRole('button',{name:'Use cancellation wording'}).click();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toContainText('cancelled your test drive');expect(state.writes).toEqual([]);
});
test('phone cancellation stays unfinished until staff record contact',async({page})=>{
 const state=await setup(page);await page.goto('/portal?section=notifications');await page.getByRole('button',{name:'Review customers',exact:true}).click();
 await page.getByRole('checkbox',{name:'Select Alex Morgan for cancellation'}).uncheck();await page.getByRole('button',{name:'Cancel selected — I’ll call'}).click();await page.getByRole('button',{name:'Confirm cancellation of 1 customer’s visits'}).click();
 const jamie=page.getByRole('link',{name:'Jamie Taylor',exact:true}).locator('xpath=ancestor::li[1]');await expect(jamie).toContainText('Appointment cancelled — contact customer');expect(state.review().remaining).toBe(3);
 await jamie.getByRole('button',{name:'I’ve spoken to them'}).click();await expect(jamie).toContainText('Contact recorded by phone');expect(state.review().remaining).toBe(2);expect(state.writes).toEqual([]);
});
test('stale cancellation fails safely and never prepares or sends an email',async({page})=>{
 const state=await setup(page,{conflict:true});await page.goto('/portal?section=notifications');await page.getByRole('button',{name:'Review customers',exact:true}).click();await page.getByRole('button',{name:'Cancel selected & prepare emails'}).click();await page.getByRole('button',{name:'Confirm cancellation of 2 customers’ visits'}).click();
 await expect(page.getByRole('alert')).toContainText('updated by someone else');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveCount(0);expect(state.actions).toHaveLength(1);expect(state.writes).toEqual([]);
});
test('optional interested customer update can be skipped without changing the enquiry',async({page})=>{
 const state=await setup(page);await page.goto('/portal?section=notifications');await page.getByRole('button',{name:'Review customers',exact:true}).click();await page.locator('summary').filter({hasText:'Other interested customers'}).click();await page.getByRole('button',{name:'Update not needed'}).click();await expect(page.getByText('Optional update marked not needed. The enquiry stays open.')).toBeVisible();expect(state.actions).toHaveLength(1);expect(state.actions[0].body.outcome).toBe('not_needed');expect(state.writes).toEqual([]);
});
test('read-only staff see work without cancellation or send controls',async({page})=>{
 const state=await setup(page,{permissions:['stock.manage']});await page.goto('/portal?section=notifications');await page.getByRole('button',{name:'Review customers',exact:true}).click();await expect(page.getByRole('checkbox')).toHaveCount(0);await expect(page.getByRole('button',{name:'Cancel selected & prepare emails'})).toHaveCount(0);expect(state.actions).toEqual([]);expect(state.writes).toEqual([]);
});
test('Home reports follow-up loading failures instead of claiming everything is clear',async({page})=>{
 await setup(page,{followUpError:true});await page.goto('/portal?section=notifications');await expect(page.getByRole('alert').filter({hasText:'Sold car follow-ups could not be refreshed.'})).toBeVisible();await expect(page.getByText('You’re up to date',{exact:true})).toHaveCount(0);
});

test('recovers a submitted email after reopening without sending another copy',async({page})=>{
 const state=await setup(page,{submitted:true});await page.goto('/portal?section=notifications');await page.getByRole('button',{name:'Review customers',exact:true}).click();
 const alex=page.getByRole('link',{name:'Alex Morgan',exact:true}).locator('xpath=ancestor::li[1]');await expect(alex.getByRole('button',{name:'Review cancellation email'})).toHaveCount(0);await alex.getByRole('button',{name:'Email already submitted — finish follow-up'}).click();
 await expect(page.getByText('The existing email submission has been confirmed. No second email was sent.')).toBeVisible();expect(state.actions).toHaveLength(1);expect(state.actions[0].body.outcome).toBe('email');expect(state.writes).toEqual([]);
});

test('an expired uncancelled visit can be completed by phone without cancelling a past booking',async({page})=>{
 const state=await setup(page,{expired:true});await page.goto('/portal?section=notifications');await page.getByRole('button',{name:'Review customers',exact:true}).click();
 await expect(page.getByText('Visit time has passed — contact customer')).toBeVisible();await expect(page.getByRole('checkbox')).toHaveCount(0);await expect(page.getByText('Appointment cancelled — contact customer')).toHaveCount(0);
 await page.getByRole('button',{name:'I’ve spoken to them'}).click();await expect(page.getByText('No customers waiting',{exact:true})).toBeVisible();expect(state.review().remaining).toBe(0);expect(state.actions).toHaveLength(1);expect(state.actions[0].body.action).toBe('complete');expect(state.actions[0].body.outcome).toBe('phone');expect(state.writes).toEqual([]);
});

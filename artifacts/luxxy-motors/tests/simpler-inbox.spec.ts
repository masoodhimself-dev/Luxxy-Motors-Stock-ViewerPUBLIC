import { test, expect } from '@playwright/test';
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Fictional local Inbox only.');
for(const width of [390,834,1440]) {
 test(`Inbox attention, conversation and actions at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  const writes:string[]=[], errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{
   if(['GET','HEAD'].includes(route.request().method()))return route.continue();
   writes.push(route.request().url());return route.abort();
  });
  const id='00000000-0000-4000-8000-000000000991';
  const enquiry={id,reference:'TEST-HIDDEN',type:'general',source:'phone',status:'contacted',customerName:'Fictional Inbox Customer',phone:'07700900123',email:'inbox@example.test',vehicleId:null,vehicleTitle:'Toyota Yaris',message:'Please tell me about the service history.',callOutcome:'information_given',workspaceRevision:1,followUpRevision:1,createdAt:'2026-10-22T09:00:00Z',events:[]};
  await page.route('**/api/enquiries',route=>route.fulfill({json:[enquiry]}));
  await page.route('**/api/staff/email/reply-attention',route=>route.fulfill({json:{enquiries:[{enquiryId:id,pending:2,review:0}]}}));
  await page.route(`**/api/staff/enquiries/${id}/conversations`,route=>route.fulfill({json:{events:[{id:'reply-1',kind:'conversation_logged',actor:'customer',summary:'Customer email received',note:'Can I visit tomorrow?\n\nOn Fri, 23 Oct 2026, Dealer wrote:\nLong old quote',occurredAt:'2026-10-23T10:00:00Z'}],total:1,nextCursor:null}}));
  await page.goto('/portal?section=notifications&workView=customers');
  const filters=page.getByRole('group',{name:'Filter enquiries by next step'});
  await expect(filters.getByRole('button',{name:'Needs reply 1',exact:true})).toBeVisible();
  await expect(filters.getByRole('button',{name:'No task scheduled 0',exact:true})).toBeVisible();
  await filters.getByRole('button',{name:'Needs reply 1',exact:true}).click();
  await page.getByRole('button',{name:'Open enquiry for Fictional Inbox Customer, Toyota Yaris',exact:true}).click();
  const detail=page.getByRole('region',{name:'Selected enquiry: Fictional Inbox Customer'});
  await expect(detail.getByRole('heading',{name:'Fictional Inbox Customer',exact:true})).toBeVisible();
  await expect(detail.getByText('Can I visit tomorrow?',{exact:true})).toBeVisible();
  await expect(detail.getByText('Show original message')).toBeVisible();
  await expect(detail.getByText('Long old quote',{exact:false})).not.toBeVisible();
  await expect(detail.getByRole('button',{name:'Set follow-up',exact:true})).toBeVisible();
  await expect(detail.getByRole('button',{name:'Reply',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`/private/tmp/luxxy-inbox-${width}.png`,fullPage:true});
  if(width<900) {
   await expect(filters).not.toBeVisible();
   await detail.getByRole('button',{name:'Back to enquiries',exact:true}).click();
   await expect(filters).toBeVisible();
  }
  expect(writes).toEqual([]);expect(errors).toEqual([]);
 });
}

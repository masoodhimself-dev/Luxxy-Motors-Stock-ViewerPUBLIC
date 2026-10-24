import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createSaleWorkspace,changeSaleWorkspace,saleWorkspaceBranding,type SaleWorkspaceCommand,type SaleWorkspaceContext} from '@workspace/vehicle-meta';
import {saleDocumentPdf} from '../../api-server/src/lib/sale-document-pdf';

test.skip(process.env.LUXXY_LOCAL_PREVIEW!=='1','Fictional intercepted sales only. No real messages or records.');
for(const width of [390,834,1440])for(const kind of ['full','deposit'] as const)test(`${kind} invoice ready, PDF and manual sharing at ${width}`,async({page,request})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:1000});
  const settings=await(await request.get('/api/dealer-settings')).json();
  const stock=await(await request.get('/api/stock')).json();
  const car=stock.cars.find((car:any)=>car.inventoryStatus==='available');
  const enquiryId='88888888-8888-4888-8888-888888888888';
  let serial=0;
  const context:SaleWorkspaceContext={now:new Date().toISOString(),actor:'Fictional invoice tester',branding:saleWorkspaceBranding(settings),nextId:()=>crypto.randomUUID(),nextNumber:type=>`TEST-${type}-${++serial}`};
  let sale=createSaleWorkspace({requestId:'fictional-ready-create',draft:{customer:'Fictional Invoice Buyer',phone:'07700900123',email:'buyer@example.test',vehicleId:car.id,vehicle:car.title,registration:'AB20XYZ',price:'10000',sourceEnquiryId:kind==='full'?'':enquiryId,fulfilment:{method:'delivery',viewed:'viewed',address:'25 Test Road\nLondon\nHA2 8LY',recipient:'Fictional Invoice Buyer',phone:'07700900123',scheduledDate:'2026-10-27',timeWindow:'Afternoon',instructions:'PRIVATE STAFF NOTE',driver:'PRIVATE DRIVER',stage:'booked'}}},context,'TEST-SALE').sale;
  function change(command:SaleWorkspaceCommand){sale=changeSaleWorkspace(sale,command,{requestId:crypto.randomUUID(),expectedRevision:sale.revision},context).sale;}
  change({action:'invoice-payment',payment:{amount:kind==='full'?'10000':'500',method:'Bank transfer',date:'2026-10-24',reference:'Fictional payment',kind:kind==='full'?'final-payment':'deposit',status:'confirmed'}});
  change({action:'issue-invoice',kind,acknowledge:true});
  const document=sale.documents.at(-1)!,pdf=saleDocumentPdf(document);
  const originalPayments=JSON.stringify(sale.payments),originalDocuments=JSON.stringify(sale.documents);
  const buyer={id:enquiryId,customerName:sale.draft.customer,phone:sale.draft.phone,email:sale.draft.email,vehicleId:car.id};
  let emails=0,pdfRequests=0,shareBody:any;const history:any[]=[],unexpected:string[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(path==='/api/sale-workspace')return route.fulfill({json:{sales:[sale]}});
    if(path===`/api/sale-workspace/${sale.id}`)return route.fulfill({json:{sale}});
    if(path==='/api/staff/access')return route.fulfill({json:{role:'owner',permissions:['sales.manage','sales.handover'],user:{authUserId:'fictional-owner',name:'Fictional owner'}}});
    if(path==='/api/staff/phone-sharing-settings')return route.fulfill({json:{revision:1,enabled:true}});
    if(path===`/api/staff/sold-vehicle-follow-ups/${sale.id}`)return route.fulfill({json:{saleId:sale.id,vehicleId:car.id,vehicleTitle:car.title,registration:'AB20XYZ',sold:false,createdAt:null,customers:[],remaining:0,upcomingAppointments:0}});
    if(path===`/api/sale-workspace/${sale.id}/documents/${document.id}/pdf`){pdfRequests++;return route.fulfill({contentType:'application/pdf',body:pdf});}
    if(path===`/api/sale-workspace/${sale.id}/documents/${document.id}/email`){
      const body=req.postDataJSON();emails++;
      const result=changeSaleWorkspace(sale,{action:'email-status',delivery:{id:body.requestId,documentId:document.id,to:buyer.email,status:'sent',attemptedAt:context.now}},body,context);sale=result.sale;
      return route.fulfill({json:result});
    }
    if(path==='/api/staff/phone-shares/enquiries')return route.fulfill({json:{enquiries:[buyer],canCreate:true}});
    if(path==='/api/staff/phone-shares'&&req.method()==='POST'){
      shareBody=req.postDataJSON();
      if(shareBody.source.kind==='message'&&['enquiryId','vehicleId'].some(key=>key in shareBody.source&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shareBody.source[key])))return route.fulfill({status:400,json:{error:'Check the sharing request.'}});
      return route.fulfill({json:{id:'fictional-pack',url:`http://127.0.0.1:4210/phone-share#${shareBody.token}`,message:shareBody.source.kind==='document'?'Hello, here is your saved invoice.':shareBody.source.message,customerPhone:buyer.phone,customerEmail:buyer.email,customerName:buyer.customerName,enquiryId,vehicleId:car.id,hasAttachments:shareBody.source.kind==='document',expiresAt:new Date(Date.now()+900000).toISOString(),preview:true}});
    }
    if(path==='/api/staff/phone-shares/confirm-whatsapp'){history.push(req.postDataJSON());return route.fulfill({json:{enquiryId,confirmedAt:context.now,preview:true}});}
    if(['GET','HEAD'].includes(req.method()))return route.continue();
    unexpected.push(path);return route.abort();
  });
  await page.goto(`/portal?section=sales&saleId=${sale.id}`);
  await expect(page.getByRole('heading',{name:'Sale summary',exact:true})).toBeVisible();
  const panel=page.getByRole('region',{name:'Collection and delivery',exact:true});
  await expect(panel).toHaveCount(1);expect(emails).toBe(0);
  if(kind==='full')await page.getByRole('button',{name:'Review sale completion',exact:true}).click();
  else{
    await page.getByRole('region',{name:'Saved sale summary'}).getByRole('button',{name:'WhatsApp QR',exact:true}).click();
    await page.getByRole('dialog',{name:'Send on WhatsApp'}).getByRole('button',{name:'Use email instead',exact:true}).click();
  }
  await expect(page.getByRole('heading',{name:'Your invoice is ready.',exact:true})).toBeVisible();
  for(let pass=0;pass<2;pass++){
    await page.getByRole('button',{name:'Email customer',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'Invoice emailed to the customer.'})).toBeVisible();
    await expect(panel).toHaveCount(1);
  }
  expect(emails).toBe(2);
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download PDF',exact:true}).click();
  const download=await downloaded;expect(download.suggestedFilename()).toBe(`${document.number}.pdf`);expect(await readFile((await download.path())!)).toEqual(pdf);
  const opened=page.waitForEvent('popup');await page.getByRole('button',{name:'Open & print invoice',exact:true}).click();const popup=await opened;await popup.waitForURL(/^blob:/);await popup.close();expect(pdfRequests).toBe(2);
  await panel.getByRole('button',{name:'Email confirmation',exact:true}).click();
  const prepare=page.getByRole('dialog',{name:'Prepare customer email'});await expect(prepare.getByLabel('Customer email',{exact:true})).toHaveValue(buyer.email);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'WhatsApp QR',exact:true}).click();const share=page.getByRole('dialog',{name:'Send on WhatsApp'});
  await expect(share.getByLabel('Customer WhatsApp number',{exact:true})).toHaveValue(buyer.phone);
  await expect(share.getByRole('link',{name:'Open WhatsApp',exact:true})).toHaveAttribute('href',/^https:\/\/wa.me\/447700900123\?/);
  expect(new URL((await share.getByRole('link',{name:'Open WhatsApp',exact:true}).getAttribute('href'))!).searchParams.get('text')).toContain('/phone-share#');
  expect(shareBody.source).toEqual({kind:'document',saleId:sale.id,documentId:document.id});expect(history).toHaveLength(0);
  await share.getByRole('button',{name:'I’ve sent it',exact:true}).click();await expect(share.getByText('WhatsApp sent — staff confirmed',{exact:true})).toBeVisible();expect(history).toHaveLength(1);expect(history[0]).toMatchObject({enquiryId,phone:buyer.phone,confirmed:true});await page.keyboard.press('Escape');
  await panel.getByRole('button',{name:'WhatsApp confirmation',exact:true}).click();const deliveryShare=page.getByRole('dialog',{name:'Send on WhatsApp'});await expect(deliveryShare.getByRole('link',{name:'Open WhatsApp',exact:true})).toBeVisible();expect(shareBody.source.message).toContain('25 Test Road');expect(shareBody.source.message).not.toMatch(/PRIVATE/);await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(JSON.stringify(sale.payments)).toBe(originalPayments);expect(JSON.stringify(sale.documents)).toBe(originalDocuments);expect(sale.completedAt).toBeUndefined();expect(unexpected).toEqual([]);expect(errors).toEqual([]);
  await page.locator('.invoice-builder-scroll').evaluate(element=>{element.scrollTop=0;});
  await page.screenshot({path:`/tmp/luxxy-invoice-ready-${kind}-${width}.png`,fullPage:true});
});

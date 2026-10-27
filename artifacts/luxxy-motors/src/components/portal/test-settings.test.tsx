import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { DealerSettingsPanel } from '../dealer-settings-panel';
import { previewSettings } from '../../../preview/settings';
import { EmailTemplatesSettings } from '../email-templates-settings';
import { SalesPaperworkSettings } from '../sales-paperwork-settings';
import { defaultEmailTemplates, defaultInvoiceSettings } from '@workspace/vehicle-meta';
import { TestTeamSettings } from './test-team-settings';

afterEach(()=>vi.unstubAllGlobals());
it('saves booking settings exclusively to the isolated session',async()=>{
  const requests:Array<{url:string,method:string}> = [];
  let settings=structuredClone(previewSettings),revision=1;
  settings.testDriveBooking!.enabled=true;
  vi.stubGlobal('fetch',vi.fn(async (input,init)=>{
    const url=String(input),method=init?.method??'GET';requests.push({url,method});
    if(url==='/api/features') return Response.json({features:{testDriveBookings:true}});
    if(url==='/api/sales-test/sessions/session-123/settings') {
      if(method==='PATCH'){const body=JSON.parse(init.body);expect(body.group).toBe('bookings');expect(body.expectedRevision).toBe(revision);settings=body.config;revision++;}
      return Response.json({config:settings,revision});
    }
    throw new Error(`Unexpected live settings request ${method} ${url}`);
  }));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><DealerSettingsPanel group="bookings" testSessionId="session-123" /></QueryClientProvider>);
  fireEvent.click(await screen.findByTestId('checkbox-test-drive-enabled'));
  fireEvent.click(screen.getByRole('button',{name:'Save bookings'}));
  await screen.findByText('Saved in this test. Live settings are unchanged.');
  expect(settings.testDriveBooking!.enabled).toBe(false);
  await waitFor(()=>expect(requests.filter(item=>item.method==='PATCH')).toEqual([{url:'/api/sales-test/sessions/session-123/settings',method:'PATCH'}]));
  expect(requests.some(item=>item.url==='/api/dealer-settings' || item.url==='/api/dealer-settings/bookings')).toBe(false);
});
it('saves message wording to the test session only',async()=>{
  const calls:Array<{url:string,method:string}>=[];
  const templates=structuredClone(defaultEmailTemplates), first=templates.find(item=>item.id==='enquiry_acknowledgement')!;let revision=1;
  vi.stubGlobal('fetch',vi.fn(async (input,init)=>{const url=String(input),method=init?.method??'GET';calls.push({url,method});
    if(url!=='/api/sales-test/sessions/session-123/email-templates')throw Error(`Unexpected request ${url}`);
    if(method==='PUT'){const body=JSON.parse(init.body);expect(body.expectedRevision).toBe(revision);Object.assign(first,{subject:body.subject,body:body.body});revision++;}
    return Response.json({templates,revision,variables:[]});
  }));
  render(<EmailTemplatesSettings testSessionId="session-123" />);
  const subject=await screen.findByLabelText('Subject');fireEvent.change(subject,{target:{value:'Updated test subject'}});
  fireEvent.click(screen.getByRole('button',{name:'Save wording'}));
  await screen.findByText('Wording saved in this test. No message was sent.');
  expect(calls.map(item=>item.url)).toEqual(['/api/sales-test/sessions/session-123/email-templates','/api/sales-test/sessions/session-123/email-templates']);
});
it('saves invoice wording only within the test session',async()=>{
  const calls:Array<{url:string,method:string}>=[];
  let data={revision:1,saleTerms:'Old',reservationTerms:'Deposit',invoiceSettings:defaultInvoiceSettings,correctionSettings:{handling:'accountant',instructions:''}};
  vi.stubGlobal('fetch',vi.fn(async (input,init)=>{const url=String(input),method=init?.method??'GET';calls.push({url,method});
    if(url!=='/api/sales-test/sessions/session-123/paperwork')throw Error(`Unexpected request ${url}`);
    if(method==='PUT'){const body=JSON.parse(init.body);expect(body.expectedRevision).toBe(data.revision);data={...data,...body,revision:data.revision+1};}
    return Response.json(data);
  }));
  render(<SalesPaperworkSettings testSessionId="session-123" />);
  fireEvent.change(await screen.findByLabelText('Terms and conditions of sale'),{target:{value:'Test terms'}});
  fireEvent.click(screen.getByRole('button',{name:'Save document settings'}));
  await screen.findByText('Document settings saved in this test. Live records are unchanged.');
  expect(calls.map(item=>item.url)).toEqual(['/api/sales-test/sessions/session-123/paperwork','/api/sales-test/sessions/session-123/paperwork']);
});
it('records a practice staff invitation without calling the real invitation service',async()=>{
  const calls:Array<{url:string,method:string}>=[];let revision=1;let members:any[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input,init)=>{const url=String(input),method=init?.method??'GET';calls.push({url,method});
    if(url!=='/api/sales-test/sessions/session-123/team')throw Error(`Unexpected request ${url}`);
    if(method==='POST'){const body=JSON.parse(init.body);expect(body.expectedRevision).toBe(revision);members=[{id:'copy',name:null,email:body.email,role:body.role,active:false,invited:true}];revision++;}
    return Response.json({members,revision});
  }));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TestTeamSettings sessionId="session-123" /></QueryClientProvider>);
  fireEvent.change(await screen.findByLabelText('Staff email'),{target:{value:'staff@example.test'}});
  fireEvent.click(screen.getByRole('button',{name:'Create practice invitation'}));
  await screen.findByText('staff@example.test');
  expect(screen.getByText('Practice invitation')).toBeVisible();
  expect(calls.filter(call=>call.method==='POST')).toEqual([{url:'/api/sales-test/sessions/session-123/team',method:'POST'}]);
});

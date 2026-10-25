import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultWhatsAppTemplates, whatsappTemplateVariables } from '@workspace/vehicle-meta';
import { PhoneSharingSettings } from './phone-sharing-settings';
import { DealerIntegrationsSettings } from './dealer-integrations-settings';

vi.mock('@/lib/dealer-features',()=>({useDealerFeatures:()=>({data:{features:{customerEmails:true}},isLoading:false,isError:false,isFetching:false})}));
const clients:QueryClient[]=[];
beforeEach(()=>vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}}));
afterEach(()=>{clients.splice(0).forEach(client=>client.clear());vi.restoreAllMocks();vi.unstubAllGlobals();});
const sharingPath='/api/staff/phone-sharing-settings',templatesPath='/api/staff/whatsapp-templates',connectionsPath='/api/dealer-integrations',stockPath='/api/dealer-integrations/stock-connection';
function api(keyConfigured=false){
  let revision=4;
  const sharing={enabled:true,invoiceQrEnabled:false};
  const templates=defaultWhatsAppTemplates.map(template=>({...template}));
  let resend={enabled:false,apiKeyConfigured:keyConfigured,from:'sales@example.test',replyTo:''};
  const stripe={enabled:false,mode:'test',publishableKeyConfigured:false,secretKeyConfigured:false,webhookSecretConfigured:false};
  let connection={platform:'autotrader',retailerId:'fictional-retailer',sourceUrl:'https://www.autotrader.co.uk/dealers/example',enabled:false};
  const writes:Array<{path:string;body:any}>=[],attempts:Array<{path:string;body:any}>=[];
  let afterPut:((path:string)=>void)|undefined;
  const response=(path:string)=>path===sharingPath?{revision,...sharing}:path===templatesPath?{revision,templates,variables:whatsappTemplateVariables}:path===stockPath?{revision,connection,importSecretConfigured:true,latest:null}:{revision,resend,stripe,readiness:{resend:{ready:false,issues:[]},stripe:{ready:false,issues:[]},message:'Local checks only.'}};
  vi.stubGlobal('fetch',vi.fn(async(input,init)=>{
    const path=String(input);
    if(![sharingPath,templatesPath,connectionsPath,stockPath].includes(path))throw new Error(`Unexpected path ${path}`);
    if(init?.method==='PUT'){
      const body=JSON.parse(String(init.body));attempts.push({path,body});
      if(body.expectedRevision!==revision)return Response.json({error:'These settings changed. Reload before saving.'},{status:409});
      writes.push({path,body});revision++;
      if(path===sharingPath){sharing.enabled=body.enabled;sharing.invoiceQrEnabled=body.invoiceQrEnabled;}
      if(path===templatesPath){templates.find(template=>template.id===body.id)!.body=body.body;}
      if(path===stockPath)connection=body.connection;
      if(path===connectionsPath)resend={enabled:body.resend.enabled,from:body.resend.from,replyTo:body.resend.replyTo,apiKeyConfigured:resend.apiKeyConfigured||Boolean(body.resend.apiKey)};
      const result=structuredClone(response(path));afterPut?.(path);return Response.json(result);
    }
    return Response.json(response(path));
  }));
  return{writes,attempts,afterNextSave(callback:(path:string)=>void){afterPut=path=>{afterPut=undefined;callback(path);};},externalTemplateChange(){revision++;templates.find(template=>template.id==='enquiry')!.body='Changed by another owner';},externalConnectionsChange(){revision++;resend={...resend,from:'other-owner@example.test'};},externalStockChange(){revision++;connection={...connection,sourceUrl:'https://www.autotrader.co.uk/dealers/other-owner'};},externalSharingChange(){revision++;sharing.enabled=false;},externalCredentialRotation(){revision++;/* Masked configured flags deliberately stay identical. */}};
}
function show(node:React.ReactNode){const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});clients.push(client);return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);}
async function openSharing(){show(<PhoneSharingSettings/>);await screen.findByRole('switch',{name:'Allow WhatsApp QR sharing'});fireEvent.click(screen.getByText('Edit message templates'));await screen.findByLabelText('WhatsApp message');}
async function openConnections(){show(<DealerIntegrationsSettings/>);await screen.findByLabelText('Authorised stock page');await screen.findByLabelText('Sender');fireEvent.click(screen.getByText('Change connection setup'));}

it('saves sharing then a WhatsApp template using the refreshed global revision',async()=>{
  const state=api();await openSharing();
  fireEvent.click(screen.getByRole('switch',{name:'Share invoices by WhatsApp QR'}));fireEvent.click(screen.getByRole('button',{name:'Save sharing settings'}));
  await screen.findByText('WhatsApp & QR settings saved.');
  fireEvent.change(screen.getByLabelText('WhatsApp message'),{target:{value:'Hello {{customer_name}}, thank you for visiting.'}});
  fireEvent.click(screen.getByRole('button',{name:'Save WhatsApp template'}));await screen.findByText('WhatsApp template saved. Staff can choose it when preparing a message.');
  expect(state.writes.map(write=>[write.path,write.body.expectedRevision])).toEqual([[sharingPath,4],[templatesPath,5]]);
});
it('saves a WhatsApp template then the sharing preference without an avoidable conflict',async()=>{
  const state=api();await openSharing();
  fireEvent.change(screen.getByLabelText('WhatsApp message'),{target:{value:'A new message from {{dealer_name}}.'}});fireEvent.click(screen.getByRole('button',{name:'Save WhatsApp template'}));
  await screen.findByText('WhatsApp template saved. Staff can choose it when preparing a message.');
  fireEvent.click(screen.getByRole('switch',{name:'Share invoices by WhatsApp QR'}));fireEvent.click(screen.getByRole('button',{name:'Save sharing settings'}));await screen.findByText('WhatsApp & QR settings saved.');
  expect(state.writes.map(write=>[write.path,write.body.expectedRevision])).toEqual([[templatesPath,4],[sharingPath,5]]);
});
it('retains dirty wording while a sharing save advances only its unrelated global revision',async()=>{
  const state=api();await openSharing();
  fireEvent.change(screen.getByLabelText('WhatsApp message'),{target:{value:'My unsaved wording'}});
  fireEvent.click(screen.getByRole('switch',{name:'Share invoices by WhatsApp QR'}));fireEvent.click(screen.getByRole('button',{name:'Save sharing settings'}));await screen.findByText('WhatsApp & QR settings saved.');
  expect(screen.getByLabelText('WhatsApp message')).toHaveValue('My unsaved wording');
  fireEvent.click(screen.getByRole('button',{name:'Save WhatsApp template'}));await screen.findByText('WhatsApp template saved. Staff can choose it when preparing a message.');
  expect(state.writes[1].body).toMatchObject({expectedRevision:5,body:'My unsaved wording'});
});
it('retains an unsaved sharing switch while a template save advances the unrelated revision',async()=>{
  const state=api();await openSharing();
  fireEvent.click(screen.getByRole('switch',{name:'Share invoices by WhatsApp QR'}));
  fireEvent.change(screen.getByLabelText('WhatsApp message'),{target:{value:'New wording'}});fireEvent.click(screen.getByRole('button',{name:'Save WhatsApp template'}));await screen.findByText('WhatsApp template saved. Staff can choose it when preparing a message.');
  expect(screen.getByRole('switch',{name:'Share invoices by WhatsApp QR'})).toBeChecked();
  fireEvent.click(screen.getByRole('button',{name:'Save sharing settings'}));await screen.findByText('WhatsApp & QR settings saved.');
  expect(state.writes[1].body).toMatchObject({expectedRevision:5,invoiceQrEnabled:true});
});
it('keeps genuine external template conflicts protected after a sibling save',async()=>{
  const state=api();await openSharing();fireEvent.change(screen.getByLabelText('WhatsApp message'),{target:{value:'Keep my draft'}});
  state.afterNextSave(()=>state.externalTemplateChange());
  fireEvent.click(screen.getByRole('switch',{name:'Share invoices by WhatsApp QR'}));fireEvent.click(screen.getByRole('button',{name:'Save sharing settings'}));await screen.findByText('WhatsApp & QR settings saved.');
  fireEvent.click(screen.getByRole('button',{name:'Save WhatsApp template'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Reload before saving');
  expect(screen.getByLabelText('WhatsApp message')).toHaveValue('Keep my draft');
  expect(state.attempts.at(-1)?.body.expectedRevision).toBe(4);expect(state.writes).toHaveLength(1);
});
it('keeps genuine external sharing changes protected while a staff switch edit is pending',async()=>{
  const state=api();await openSharing();fireEvent.click(screen.getByRole('switch',{name:'Share invoices by WhatsApp QR'}));
  state.afterNextSave(()=>state.externalSharingChange());
  fireEvent.change(screen.getByLabelText('WhatsApp message'),{target:{value:'New saved wording'}});fireEvent.click(screen.getByRole('button',{name:'Save WhatsApp template'}));await screen.findByText('WhatsApp template saved. Staff can choose it when preparing a message.');
  expect(screen.getByRole('switch',{name:'Allow WhatsApp QR sharing'})).toBeChecked();expect(screen.getByRole('switch',{name:'Share invoices by WhatsApp QR'})).toBeChecked();
  fireEvent.click(screen.getByRole('button',{name:'Save sharing settings'}));expect(await screen.findByRole('alert')).toHaveTextContent('Reload before saving');
  expect(state.attempts.at(-1)?.body.expectedRevision).toBe(4);expect(state.writes).toHaveLength(1);
});
it('saves private connections then stock settings using the new shared revision',async()=>{
  const state=api();await openConnections();
  fireEvent.change(screen.getByLabelText('Sender'),{target:{value:'changed@example.test'}});fireEvent.click(screen.getByRole('button',{name:'Save private settings'}));await screen.findByText('Private integration settings saved.');
  fireEvent.change(screen.getByLabelText('Authorised stock page'),{target:{value:'https://www.autotrader.co.uk/dealers/updated'}});fireEvent.click(screen.getByRole('button',{name:'Save stock connection'}));await screen.findByText('Stock connection saved. Configure Grok with the same retailer reference.');
  expect(state.writes.map(write=>[write.path,write.body.expectedRevision])).toEqual([[connectionsPath,4],[stockPath,5]]);
});
it('saves stock then private settings and keeps typed private keys only in the form until saved',async()=>{
  const storage=vi.spyOn(Storage.prototype,'setItem'),state=api();await openConnections();
  const key=screen.getByLabelText(/API key/);fireEvent.change(key,{target:{value:'re_fictional_test_key_only'}});
  fireEvent.change(screen.getByLabelText('Authorised stock page'),{target:{value:'https://www.autotrader.co.uk/dealers/updated'}});
  expect(screen.getByRole('region',{name:'Platform stock connection'})).toHaveAttribute('data-settings-dirty','true');
  fireEvent.click(screen.getByRole('button',{name:'Save stock connection'}));await screen.findByText('Stock connection saved. Configure Grok with the same retailer reference.');
  expect(key).toHaveValue('re_fictional_test_key_only');
  fireEvent.click(screen.getByRole('button',{name:'Save private settings'}));await screen.findByText('Private integration settings saved.');
  expect(state.writes.map(write=>[write.path,write.body.expectedRevision])).toEqual([[stockPath,4],[connectionsPath,5]]);
  expect(state.writes[1].body.resend.apiKey).toBe('re_fictional_test_key_only');expect(key).toHaveValue('');expect(storage).not.toHaveBeenCalled();
});
it('preserves an already edited stock page while connection settings are saved',async()=>{
  const state=api();await openConnections();
  fireEvent.change(screen.getByLabelText('Authorised stock page'),{target:{value:'https://www.autotrader.co.uk/dealers/my-draft'}});
  fireEvent.change(screen.getByLabelText('Sender'),{target:{value:'changed@example.test'}});fireEvent.click(screen.getByRole('button',{name:'Save private settings'}));await screen.findByText('Private integration settings saved.');
  expect(screen.getByLabelText('Authorised stock page')).toHaveValue('https://www.autotrader.co.uk/dealers/my-draft');
  fireEvent.click(screen.getByRole('button',{name:'Save stock connection'}));await screen.findByText('Stock connection saved. Configure Grok with the same retailer reference.');
  expect(state.writes[1].body).toMatchObject({expectedRevision:5,connection:{sourceUrl:'https://www.autotrader.co.uk/dealers/my-draft'}});
});
it('does not advance a dirty stock draft past a genuine external stock connection change',async()=>{
  const state=api();await openConnections();
  fireEvent.change(screen.getByLabelText('Authorised stock page'),{target:{value:'https://www.autotrader.co.uk/dealers/my-draft'}});
  state.afterNextSave(()=>state.externalStockChange());
  fireEvent.change(screen.getByLabelText('Sender'),{target:{value:'changed@example.test'}});fireEvent.click(screen.getByRole('button',{name:'Save private settings'}));await screen.findByText('Private integration settings saved.');
  expect(screen.getByLabelText('Authorised stock page')).toHaveValue('https://www.autotrader.co.uk/dealers/my-draft');
  fireEvent.click(screen.getByRole('button',{name:'Save stock connection'}));expect(await screen.findByRole('alert')).toHaveTextContent('Reload before saving');
  expect(state.attempts.at(-1)?.body.expectedRevision).toBe(4);expect(state.writes).toHaveLength(1);
});
it('does not overwrite dirty connection details or typed keys when a true external connection change is discovered',async()=>{
  const state=api();await openConnections();
  fireEvent.change(screen.getByLabelText('Sender'),{target:{value:'my-draft@example.test'}});fireEvent.change(screen.getByLabelText(/API key/),{target:{value:'re_unsaved_fictional_key'}});
  state.afterNextSave(()=>state.externalConnectionsChange());
  fireEvent.change(screen.getByLabelText('Authorised stock page'),{target:{value:'https://www.autotrader.co.uk/dealers/updated'}});fireEvent.click(screen.getByRole('button',{name:'Save stock connection'}));await screen.findByText('Stock connection saved. Configure Grok with the same retailer reference.');
  expect(screen.getByLabelText('Sender')).toHaveValue('my-draft@example.test');expect(screen.getByLabelText(/API key/)).toHaveValue('re_unsaved_fictional_key');
  fireEvent.click(screen.getByRole('button',{name:'Save private settings'}));expect(await screen.findByRole('alert')).toHaveTextContent('Reload before saving');
  expect(state.attempts.at(-1)?.body.expectedRevision).toBe(4);expect(state.writes).toHaveLength(1);
});
it('does not advance a dirty provider draft past a masked external credential rotation after its own stock save',async()=>{
  const state=api(true);await openConnections();
  fireEvent.change(screen.getByLabelText(/API key/),{target:{value:'re_my_unsaved_replacement_key'}});
  state.afterNextSave(()=>state.externalCredentialRotation());
  fireEvent.change(screen.getByLabelText('Authorised stock page'),{target:{value:'https://www.autotrader.co.uk/dealers/my-update'}});
  fireEvent.click(screen.getByRole('button',{name:'Save stock connection'}));await screen.findByText('Stock connection saved. Configure Grok with the same retailer reference.');
  expect(screen.getByLabelText(/API key/)).toHaveValue('re_my_unsaved_replacement_key');
  fireEvent.click(screen.getByRole('button',{name:'Save private settings'}));expect(await screen.findByRole('alert')).toHaveTextContent('Reload before saving');
  expect(state.attempts.at(-1)?.body.expectedRevision).toBe(4);expect(state.writes).toHaveLength(1);
});

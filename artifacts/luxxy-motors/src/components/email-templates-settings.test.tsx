import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultEmailAppearance, defaultEmailTemplates, emailTemplateVariables } from '@workspace/vehicle-meta';
import { EmailTemplatesSettings } from './email-templates-settings';
afterEach(()=>vi.unstubAllGlobals());
function api() {
 let revision=1;const templates=structuredClone(defaultEmailTemplates);let appearance={...defaultEmailAppearance};
 const writes: Array<{url:string;body:any}>=[];const previews: any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  const body=init?.body ? JSON.parse(init.body):undefined;
  if(String(url).endsWith('/preview')){previews.push(body);return Response.json({subject:body.subject,html:'<!doctype html><html><body><h1>Rendered sample email</h1></body></html>',text:'Plain-text sample email'});}
  if(init?.method==='PUT') {writes.push({url:String(url),body});expect(body.expectedRevision).toBe(revision);revision++;if(String(url).endsWith('/appearance'))appearance=body.appearance;else {const entry=templates.find(t=>t.id===body.id)!;entry.subject=body.subject;entry.body=body.body;entry.headline=body.headline;}}
  return Response.json({revision,templates,appearance,variables:emailTemplateVariables});
 }));return {writes,previews};
}
it('renders a server preview without writes and marks edits stale until refreshed',async()=>{
 const {writes,previews}=api();render(<EmailTemplatesSettings/>);
 await screen.findByText('Preview is current');expect(writes).toHaveLength(0);expect(previews).toHaveLength(1);
 fireEvent.change(screen.getByLabelText('Subject line'),{target:{value:'A new subject'}});
 expect(screen.getByText('Preview needs updating')).toBeInTheDocument();expect(previews).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'Update preview'}));
 await screen.findByText('Preview is current');expect(previews).toHaveLength(2);expect(writes).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Phone'}));
 expect(screen.getByTitle('Email preview using sample customer information').parentElement).toHaveClass('email-preview-phone');
 fireEvent.click(screen.getByRole('button',{name:'Plain text'}));expect(screen.getByText('Plain-text sample email')).toBeInTheDocument();
});
it('saves one template with the revision and keeps unsaved brand edits',async()=>{
 const {writes}=api();render(<EmailTemplatesSettings/>);await screen.findByText('Preview is current');
 fireEvent.click(screen.getByText('Branding for all emails'));
 fireEvent.change(screen.getByLabelText('Accent colour'),{target:{value:'#24577A'}});
 fireEvent.change(screen.getByLabelText('Your message'),{target:{value:'Hi {{customer_name}}, your car details are ready.'}});
 fireEvent.change(screen.getByLabelText('Email title'),{target:{value:'Your car awaits'}});
 fireEvent.click(screen.getByRole('button',{name:'Save template'}));
 await screen.findByText('Email template saved. Future emails will use this wording.');
 expect(writes).toHaveLength(1);expect(writes[0].body.body).toContain('your car details');expect(writes[0].body.headline).toBe('Your car awaits');expect(screen.getByLabelText('Email title')).toHaveValue('Your car awaits');expect(screen.getByLabelText('Accent colour')).toHaveValue('#24577A');
 expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
});
it('saving branding preserves the draft message and advances its revision',async()=>{
 const {writes}=api();render(<EmailTemplatesSettings/>);await screen.findByText('Preview is current');
 fireEvent.click(screen.getByText('Branding for all emails'));
 fireEvent.change(screen.getByLabelText('Your message'),{target:{value:'Unsaved message'}});
 fireEvent.click(screen.getByRole('button',{name:'Use Forest green accent'}));
 fireEvent.click(screen.getByRole('button',{name:'Save email branding'}));
 await screen.findByText('Email branding saved for every email template.');
 expect(screen.getByLabelText('Your message')).toHaveValue('Unsaved message');
 fireEvent.click(screen.getByRole('button',{name:'Save template'}));
 await waitFor(()=>expect(writes).toHaveLength(2));expect(writes[1].body.expectedRevision).toBe(2);
});
it('declining to discard wording keeps the current template selected',async()=>{
 api();vi.stubGlobal('confirm',vi.fn().mockReturnValue(false));render(<EmailTemplatesSettings/>);await screen.findByText('Preview is current');
 fireEvent.change(screen.getByLabelText('Your message'),{target:{value:'A draft to keep'}});
 fireEvent.change(screen.getByLabelText('Choose a message'),{target:{value:'booking_confirmation'}});
 expect(window.confirm).toHaveBeenCalled();expect(screen.getByLabelText('Choose a message')).toHaveValue('enquiry_acknowledgement');expect(screen.getByLabelText('Your message')).toHaveValue('A draft to keep');
});

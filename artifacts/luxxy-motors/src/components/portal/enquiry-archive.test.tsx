import { beforeEach,expect,it,vi } from 'vitest';
import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import type { Enquiry } from '@workspace/api-client-react';
const state=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('@workspace/api-client-react',()=>({customFetch:(...args:unknown[])=>state.fetch(...args)}));
vi.mock('./enquiry-workspace-tools',()=>({workspaceError:()=> 'This enquiry changed. Refresh and try again.'}));
import {EnquiryArchiveDialog,RestoreEnquiryAction} from './enquiry-archive';
const entry={id:'case-one',customerName:'Fictional Customer',vehicleTitle:'Honda Elysion',workspaceRevision:4} as Enquiry;
beforeEach(()=>{state.fetch.mockReset();});
it('archives only the selected revision after explaining the recoverable 30-day period',async()=>{
  const updated={...entry,workspaceRevision:5,archivedAt:'2026-11-03T10:00:00Z',archiveDeleteAt:'2026-12-03T10:00:00Z'},saved=vi.fn(),close=vi.fn();
  state.fetch.mockResolvedValue(updated);
  render(<EnquiryArchiveDialog entry={entry} open onOpenChange={close} onSaved={saved} hasUnsavedDraft={()=>false}/>);
  expect(screen.getByText(/You can restore it for 30 days/)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Archive enquiry'}));
  await waitFor(()=>expect(saved).toHaveBeenCalledWith(updated));
  expect(state.fetch).toHaveBeenCalledExactlyOnceWith('/api/staff/enquiries/case-one/archive',expect.objectContaining({method:'POST',body:JSON.stringify({expectedRevision:4})}));
  expect(close).toHaveBeenCalledWith(false);
});
it('keeps a dirty draft and never archives behind it',()=>{
  render(<EnquiryArchiveDialog entry={entry} open onOpenChange={vi.fn()} onSaved={vi.fn()} hasUnsavedDraft={()=>true}/>);
  expect(screen.getByRole('alert')).toHaveTextContent('Save or discard');
  expect(screen.getByRole('button',{name:'Archive enquiry'})).toBeDisabled();
  expect(state.fetch).not.toHaveBeenCalled();
});
it('keeps the dialog on a revision error rather than pretending archive succeeded',async()=>{
  state.fetch.mockRejectedValue({status:409});const saved=vi.fn();
  render(<EnquiryArchiveDialog entry={entry} open onOpenChange={vi.fn()} onSaved={saved} hasUnsavedDraft={()=>false}/>);
  fireEvent.click(screen.getByRole('button',{name:'Archive enquiry'}));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('This enquiry changed'));
  expect(saved).not.toHaveBeenCalled();
});
it('restores the archived record without sending a customer message',async()=>{
  state.fetch.mockResolvedValue({...entry,workspaceRevision:6,archivedAt:null});const saved=vi.fn();
  render(<RestoreEnquiryAction entry={{...entry,archivedAt:'2026-11-03T10:00:00Z'}} onSaved={saved}/>);
  fireEvent.click(screen.getByRole('button',{name:'Restore enquiry'}));
  await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
  expect(state.fetch).toHaveBeenCalledExactlyOnceWith('/api/staff/enquiries/case-one/restore',expect.objectContaining({body:JSON.stringify({expectedRevision:4})}));
});

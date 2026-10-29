import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => state.fetch(...args) }));
import { EnquiryTextChecks, enquiryReferences } from './enquiry-text-checks';
beforeEach(() => { state.fetch.mockReset(); });
it('detects spaced and compact references without changing the customer text or making requests', () => {
 const text='Hi, I am interested in your vehicle, my car is JD25KDW or MA06 LDW and I am coming from M6 7JX or M23DW';
 expect(enquiryReferences(text).map(({kind,value})=>[kind,value])).toEqual([['registration','JD25KDW'],['registration','MA06LDW'],['postcode','M6 7JX'],['postcode','M2 3DW']]);
 const {container}=render(<EnquiryTextChecks text={text}/>);
 expect(container.textContent).toBe(text); expect(screen.getAllByRole('button')).toHaveLength(4); expect(state.fetch).not.toHaveBeenCalled();
});
it('avoids email addresses, URLs, partial tokens, years and telephone numbers',()=>{
 expect(enquiryReferences('jd25kdw@example.com https://example.com/MA06LDW www.test.uk/M67JX XJD25KDWY 2026 07388831790')).toEqual([]);
 expect(enquiryReferences('m23dw, ma06 ldw.').map(x=>x.value)).toEqual(['M2 3DW','MA06LDW']);
});
it('opens the existing MOT dialog with the selected plate and checks only on confirmation',async()=>{
 render(<EnquiryTextChecks text="JD25KDW or MA06 LDW"/>);
 fireEvent.click(screen.getByRole('button',{name:'Check MOT history for MA06LDW'}));
 expect(screen.getByRole('textbox',{name:'Registration number'})).toHaveValue('MA06LDW'); expect(state.fetch).not.toHaveBeenCalled();
 state.fetch.mockResolvedValue({status:'unavailable'});
 fireEvent.click(screen.getByRole('button',{name:'Check MOT'}));
 await waitFor(()=>expect(state.fetch.mock.calls[0][0]).toBe('/api/staff/mot-history?registration=MA06LDW'));
});
it('requests road miles and refuses to label straight-line results as road miles',async()=>{
 state.fetch.mockResolvedValue({miles:123.4,approximate:true,distanceBasis:'driving'});
 render(<EnquiryTextChecks text="M6 7JX or M23DW"/>);
 fireEvent.click(screen.getByRole('button',{name:'Check road distance from M2 3DW'})); expect(state.fetch).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Check road distance'}));
 expect(await screen.findByRole('status')).toHaveTextContent('123.4 road miles');
 expect(state.fetch).toHaveBeenCalledWith('/api/postcodes/distance?postcode=M2%203DW&basis=road');
 state.fetch.mockResolvedValue({miles:9,approximate:true});fireEvent.click(screen.getByRole('button',{name:'Check again'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('could not be checked'); expect(screen.queryByRole('status')).toBeNull();
});
it('handles network failure without submitting or saving a message',async()=>{
 state.fetch.mockRejectedValue(new Error('offline'));
 render(<EnquiryTextChecks text="M6 7JX"/>);fireEvent.click(screen.getByRole('button',{name:'Check road distance from M6 7JX'}));fireEvent.click(screen.getByRole('button',{name:'Check road distance'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('could not be checked');
});

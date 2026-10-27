import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import { EnquirePage } from './enquire';

const calls=vi.hoisted(()=>({liveSend:vi.fn(),navigate:vi.fn(),track:vi.fn()}));
vi.mock('@workspace/api-client-react',()=>({useCreateEnquiry:()=>({mutate:calls.liveSend,reset:vi.fn(),isSuccess:false,isError:false,isPending:false}),useGetEnquiryAvailability:()=>({}),getGetEnquiryAvailabilityQueryKey:()=>[],customFetch:vi.fn()}));
vi.mock('@/lib/stock-context',()=>({useStock:()=>({stock:{cars:[]},isLoading:false,error:null})}));
vi.mock('@/lib/dealer-settings-context',()=>({useDealerSettings:()=>({settings:dealerConfig,isLoading:false,isError:false})}));
vi.mock('@/lib/dealer-features',()=>({useDealerFeatures:()=>({enabled:()=>true})}));
vi.mock('@/lib/analytics',()=>({trackEvent:calls.track}));
vi.mock('@/hooks/use-page-meta',()=>({usePageMeta:vi.fn()}));
vi.mock('wouter',()=>({useLocation:()=>['/portal',calls.navigate],useSearch:()=>'',Link:({href,children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a href={href} {...props}>{children}</a>,Redirect:()=>null}));
beforeEach(()=>{calls.liveSend.mockClear();calls.navigate.mockClear();calls.track.mockClear();sessionStorage.clear();});

it('keeps enquiry navigation and submission in the test adapter',async()=>{
 const submit=vi.fn().mockResolvedValue({appointmentStatus:null});
 render(<EnquirePage testMode={{type:'general',sessionId:'test-session',config:dealerConfig as any,customer:{name:'Copied Buyer',email:'copied@example.test',phone:'07700900123'},vehicle:{id:'test-car',title:'Ford Focus',price:5000,registration:'AA11 AAA'},submit}}/>);
 expect(screen.queryByRole('link',{name:'Change car'})).not.toBeInTheDocument();expect(screen.queryByText('Prefer to talk?')).not.toBeInTheDocument();expect(document.querySelector('a[href^="tel:"]')).toBeNull();expect(calls.navigate).not.toHaveBeenCalled();
 fireEvent.change(screen.getByTestId('textarea-enquiry-message'),{target:{value:'Is it available?'}});
 fireEvent.submit(screen.getByTestId('form-enquiry'));
 await waitFor(()=>expect(submit).toHaveBeenCalledWith(expect.objectContaining({message:'Is it available?',customerName:'Copied Buyer',visitorId:null})));
 expect(calls.liveSend).not.toHaveBeenCalled();expect(calls.track).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);
 expect(await screen.findByText('Test enquiry received')).toBeVisible();
});

it('submits a genuinely general enquiry with no linked car',async()=>{
 const submit=vi.fn().mockResolvedValue({appointmentStatus:null});
 render(<EnquirePage testMode={{type:'general',sessionId:'test-session',config:dealerConfig as any,customer:{name:'Copied Buyer',email:'copied@example.test',phone:'07700900123'},vehicle:null,submit}}/>);
 fireEvent.change(screen.getByTestId('textarea-enquiry-message'),{target:{value:'What are your hours?'}});fireEvent.submit(screen.getByTestId('form-enquiry'));
 await waitFor(()=>expect(submit).toHaveBeenCalledWith(expect.objectContaining({vehicleId:null,type:'general',message:'What are your hours?'})));
 expect(calls.liveSend).not.toHaveBeenCalled();expect(document.querySelector('a[href^="tel:"]')).toBeNull();
});

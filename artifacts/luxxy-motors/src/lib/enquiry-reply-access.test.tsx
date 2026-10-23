import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { customFetch } from '@workspace/api-client-react';
import { useReplyAttention } from './enquiry-reply-attention';
vi.mock('@workspace/api-client-react',async original=>({...await original<object>(),customFetch:vi.fn()}));
beforeEach(()=>vi.mocked(customFetch).mockReset());
function wrapper(client:QueryClient) { return ({children}:{children:React.ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>; }
it('does not request or display cached email attention without staff email access',()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 client.setQueryData(['reply-attention'],{enquiries:[{enquiryId:'private',pending:1,review:0,latestReplyText:'Private email'}]});
 const {result}=renderHook(()=>useReplyAttention(false),{wrapper:wrapper(client)});
 expect(result.current.data).toBeUndefined();expect(result.current.isFetching).toBe(false);expect(customFetch).not.toHaveBeenCalled();
});
it('loads the single aggregate for authorised staff',async()=>{
 const data={enquiries:[{enquiryId:'allowed',pending:2,review:0}]};vi.mocked(customFetch).mockResolvedValue(data);
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const {result}=renderHook(()=>useReplyAttention(true),{wrapper:wrapper(client)});
 await waitFor(()=>expect(result.current.data).toEqual(data));
 expect(customFetch).toHaveBeenCalledExactlyOnceWith('/api/staff/email/reply-attention');
});

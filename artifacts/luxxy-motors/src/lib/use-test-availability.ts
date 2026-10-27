import { useCallback, useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';

type Availability={date:string;timezone:string;slots:{startAt:string;label:string;available:boolean}[]};
export function useTestAvailability(sessionId:string|undefined,date:string,enabled:boolean) {
  const [generation,setGeneration]=useState(0);
  const [state,setState]=useState<{data?:Availability;isFetching:boolean;isLoading:boolean;isError:boolean}>({isFetching:false,isLoading:false,isError:false});
  const refetch=useCallback(()=>{setGeneration(value=>value+1);},[]);
  useEffect(()=>{if(!enabled||!sessionId){setState({isFetching:false,isLoading:false,isError:false});return;}
    const abort=new AbortController();setState({isFetching:true,isLoading:true,isError:false});
    void customFetch<Availability>(`/api/sales-test/sessions/${encodeURIComponent(sessionId)}/enquiries/availability?date=${encodeURIComponent(date)}`,{signal:abort.signal}).then(data=>{if(!abort.signal.aborted)setState({data,isFetching:false,isLoading:false,isError:false});},()=>{if(!abort.signal.aborted)setState({isFetching:false,isLoading:false,isError:true});});
    return ()=>abort.abort();
  },[sessionId,date,enabled,generation]);
  useEffect(()=>{if(!enabled)return;window.addEventListener('focus',refetch);return()=>window.removeEventListener('focus',refetch);},[enabled,refetch]);
  return {...state,refetch};
}

import { useCallback, useRef, useState } from 'react';

/** Small isolated mutation: its caller supplies the only permitted test transport. */
export function useTestRequest<TInput, TResult>(send:(input:TInput)=>Promise<TResult>) {
  const sender=useRef(send);sender.current=send;
  const [state,setState]=useState<{data?:TResult;error?:unknown;isPending:boolean;isSuccess:boolean;isError:boolean}>({isPending:false,isSuccess:false,isError:false});
  const reset=useCallback(()=>setState({isPending:false,isSuccess:false,isError:false}),[]);
  const mutate=useCallback((input:TInput,callbacks?:{onSuccess?:()=>void;onError?:()=>void;onSettled?:()=>void})=>{
    setState({isPending:true,isSuccess:false,isError:false});
    void sender.current(input).then(data=>{setState({data,isPending:false,isSuccess:true,isError:false});callbacks?.onSuccess?.();},error=>{setState({error,isPending:false,isSuccess:false,isError:true});callbacks?.onError?.();}).finally(()=>callbacks?.onSettled?.());
  },[]);
  return {...state,reset,mutate};
}

import { useEffect, useState } from 'react';
/** Public server identity, never inferred from a dealership's name. */
export function useDemoStatus() {
 const [demo,setDemo]=useState(false);
 useEffect(()=>{const controller=new AbortController();void fetch('/api/demo-status',{signal:controller.signal,cache:'no-store'}).then(r=>r.ok?r.json():null).then(data=>setDemo(data?.demo===true)).catch(()=>{});return()=>controller.abort();},[]);
 return demo;
}

import { useEffect, useId, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
export type PostcodeLocation = {postcode:string;latitude:number|null;longitude:number|null;region:string|null;administrativeArea:string|null};
const complete=(s:string)=>/^(?:GIR\s*0AA|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})$/i.test(s.trim());
export function PostcodeField({value,onChange,onLocation,disabled=false,label='Postcode',showDistance=false,helpText='Postcode only — enter the house number and street separately.'}:{value:string;onChange:(value:string)=>void;onLocation?:(value:PostcodeLocation|null)=>void;disabled?:boolean;label?:string;showDistance?:boolean;helpText?:string}) {
 const id=useId(),root=useRef<HTMLDivElement>(null),callbacks=useRef({onLocation});callbacks.current={onLocation};
 const [suggestions,setSuggestions]=useState<string[]>([]),[active,setActive]=useState(-1),[focused,setFocused]=useState(false),[notice,setNotice]=useState(''),[location,setLocation]=useState<PostcodeLocation|null>(null),[miles,setMiles]=useState<number|null>(null);
 const sequence=useRef(0);
 useEffect(()=>{
  const seq=++sequence.current,controller=new AbortController();
  setSuggestions([]);setActive(-1);setNotice('');setLocation(null);setMiles(null);callbacks.current.onLocation?.(null);
  if(disabled || value.trim().length<2)return;
  const timer=setTimeout(async()=>{
   try {
    if(complete(value)){
     const result=await customFetch<{location:PostcodeLocation}>(`/api/postcodes?postcode=${encodeURIComponent(value.trim())}`,{signal:controller.signal});
     if(seq!==sequence.current || controller.signal.aborted)return;
     setLocation(result.location);callbacks.current.onLocation?.(result.location);setNotice('Postcode checked');
     if(showDistance){
      try {const distance=await customFetch<{miles:number|null}>(`/api/postcodes/distance?postcode=${encodeURIComponent(result.location.postcode)}`,{signal:controller.signal});if(seq===sequence.current && !controller.signal.aborted)setMiles(distance.miles);}catch{/* Distance is optional. */}
     }
    }else{
     const result=await customFetch<{postcodes:string[]}>(`/api/postcodes?query=${encodeURIComponent(value.trim())}`,{signal:controller.signal});
     if(seq===sequence.current && !controller.signal.aborted)setSuggestions(result.postcodes);
    }
   } catch(error){if(seq===sequence.current && !controller.signal.aborted){const code=(error as {data?:{code?:string}})?.data?.code;setNotice(code==='invalid'||code==='not_found'?'Postcode not found. Check it or continue with manual entry.':'Postcode lookup unavailable. You can still enter the address manually.');}}
  },350);
  return()=>{clearTimeout(timer);controller.abort();};
 },[value,disabled,showDistance]);
 function select(postcode:string){onChange(postcode);setSuggestions([]);setActive(-1);}
 const open=focused && suggestions.length>0;
 return <div ref={root} className="relative min-w-0" onBlur={e=>{if(!root.current?.contains(e.relatedTarget as Node))setFocused(false);}}>
  <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
  <Input id={id} value={value} disabled={disabled} maxLength={20} autoComplete="postal-code" spellCheck={false} autoCapitalize="characters" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open?`${id}-options`:undefined} aria-activedescendant={open && active>=0?`${id}-${active}`:undefined} aria-describedby={`${id}-help`} onFocus={()=>setFocused(true)} onChange={e=>onChange(e.target.value)} onBlur={()=>{if(location && value!==location.postcode)onChange(location.postcode);}} onKeyDown={e=>{
   if(e.key==='Escape'){if(open){e.preventDefault();e.stopPropagation();}setFocused(false);setActive(-1);return;}
   if(!open)return;
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setActive(current=>current<0 ? (e.key==='ArrowDown'?0:suggestions.length-1) : (current+(e.key==='ArrowDown'?1:suggestions.length-1))%suggestions.length);}
   if(e.key==='Enter' && active>=0){e.preventDefault();select(suggestions[active]);}
  }}/>
  {open && <ul id={`${id}-options`} role="listbox" aria-label="Postcode suggestions" className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-card p-1 text-foreground shadow-md">{suggestions.map((postcode,index)=><li key={postcode} id={`${id}-${index}`} role="option" aria-selected={active===index}><button type="button" tabIndex={-1} className={`min-h-11 w-full rounded px-3 text-left hover:bg-muted ${active===index?'bg-muted':''}`} onMouseDown={e=>e.preventDefault()} onClick={()=>select(postcode)}>{postcode}</button></li>)}</ul>}
  <p id={`${id}-help`} role={notice ? "status" : undefined} aria-live="polite" className="mt-1 text-xs leading-5 text-muted-foreground">{notice || helpText}{location && [location.administrativeArea,location.region].filter(Boolean).length>0?` · ${[...new Set([location.administrativeArea,location.region].filter(Boolean))].join(', ')}`:''}{miles!==null?` · About ${miles} miles from the dealership (straight-line)`:''}</p>
 </div>;
}
/** Existing free-text address contracts stay unchanged. Add a verified postcode only on request. */
export function AddressPostcodeHelper({address,onChange,disabled=false}:{address:string;onChange:(value:string)=>void;disabled?:boolean}){
 const [postcode,setPostcode]=useState(''),[location,setLocation]=useState<PostcodeLocation|null>(null);
 if(disabled)return null;
 return <details className="my-2 min-w-0 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium">Check a postcode (optional)</summary><PostcodeField value={postcode} onChange={setPostcode} onLocation={setLocation} showDistance label="Address postcode"/><Button type="button" variant="outline" size="sm" className="mt-2" disabled={!location} onClick={()=>{
  if(!location)return;
  const without=address.trim().replace(/(?:^|[,\n]\s*|\s+)(?:GIR\s*0AA|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})$/i,'').trim();
  onChange(`${without}${without?'\n':''}${location.postcode}`);
 }}>Use postcode in address</Button></details>;
}
export function OptionalJourneyPostcode(){
 const [postcode,setPostcode]=useState('');
 return <details className="min-w-0 border-t border-border pt-2 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium">Check distance to the showroom (optional)</summary><PostcodeField label="Your postcode (optional)" value={postcode} onChange={setPostcode} showDistance/><p className="mt-1 text-xs text-muted-foreground">Used for this distance check only; it is not added to your booking.</p></details>;
}

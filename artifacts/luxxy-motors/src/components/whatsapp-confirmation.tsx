import { customerWhatsAppNumber } from "@/lib/customer-whatsapp";
import { useContext, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

type Customer = {id:string;requestedEnquiryId?:string;customerName:string;phone?:string;email?:string;vehicleTitle?:string;vehicleId?:string};
export type WhatsAppConfirmationRequest = {requestId:string;enquiryId?:string;newCustomer?:{name:string;email?:string};vehicleId?:string;grantId?:string;phone:string;message:string;confirmed:true};
export type WhatsAppConfirmationResult = {enquiryId:string;confirmedAt:string;preview?:boolean};
export function WhatsAppConfirmation({enquiryId,customerName='',customerEmail='',preferKnownCustomer=false,disabled=false,phone,message,grantId,vehicleId,attempt,result,onConfirmed,onLock,onPhone,onEmail,onReadyChange,onCustomerChange,children}: {
  enquiryId?:string;customerName?:string;customerEmail?:string;preferKnownCustomer?:boolean;disabled?:boolean;phone:string;message:string;grantId?:string;vehicleId?:string;
  attempt:MutableRefObject<WhatsAppConfirmationRequest|null>;result:WhatsAppConfirmationResult|null;
  onConfirmed:(value:WhatsAppConfirmationResult)=>void;onLock:(value:boolean)=>void;onPhone:(value:string)=>void;onEmail:(value:string)=>void;
  onReadyChange?:(ready:boolean)=>void;children?:ReactNode;
  onCustomerChange?:(customer:{enquiryId?:string;customerName:string;createNew?:boolean}|null)=>void;
}) {
  const cache=useContext(QueryClientContext);
  const [selected,setSelected]=useState(enquiryId||''),[search,setSearch]=useState(enquiryId?'':phone),[customers,setCustomers]=useState<Customer[]>([]);
  const [create,setCreate]=useState(false),[name,setName]=useState(customerName),[canCreate,setCanCreate]=useState(false),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [lookupError,setLookupError]=useState(''),[lookupRetry,setLookupRetry]=useState(0),[acknowledgedMismatch,setAcknowledgedMismatch]=useState('');
  const initialIdentityApplied=useRef(false);
  const latestPhone=useRef(phone);
  latestPhone.current=phone;
  useEffect(()=>{
    let current=true;
    setLoading(true);setLookupError('');
    const lookup=()=>{
      void customFetch<{enquiries:Customer[];canCreate?:boolean}>(`/api/staff/phone-shares/enquiries?${enquiryId?`id=${encodeURIComponent(enquiryId)}`:`q=${encodeURIComponent(search)}`}`)
        .then(data=>{
          if(!current)return;
          const rows=data?.enquiries||[],customer=enquiryId?rows.find(item=>item.id===enquiryId||item.requestedEnquiryId===enquiryId):undefined;
          setCustomers(rows);setCanCreate(data?.canCreate===true);
          // Documents already identify the customer and vehicle. Never attach an
          // invoice to another car merely because its enquiry shares a phone.
          if(preferKnownCustomer&&!enquiryId&&!initialIdentityApplied.current){
            initialIdentityApplied.current=true;
            const number=customerWhatsAppNumber(latestPhone.current);
            const matches=rows.filter(item=>vehicleId&&item.vehicleId===vehicleId&&number&&customerWhatsAppNumber(item.phone||'')===number&&item.customerName.trim().toLocaleLowerCase()===customerName.trim().toLocaleLowerCase());
            if(matches.length===1)setSelected(matches[0].id);
            else if(matches.length===0&&data?.canCreate===true&&customerName.trim().length>=2)setCreate(true);
          }
          // A delayed lookup must never replace a number staff already entered.
          if(customer?.phone&&!latestPhone.current.trim())onPhone(customer.phone);
          if(customer?.email)onEmail(customer.email);
          if(enquiryId&&!customer)setLookupError('This customer enquiry could not be found. Reopen the current enquiry before sharing.');
        })
        .catch(()=>{if(current)setLookupError('Customer enquiries could not be checked. Try again before sharing.');})
        .finally(()=>{if(current)setLoading(false);});
    };
    // An exact customer link is ready to verify immediately; only typing a
    // search needs a debounce. This also keeps invoice QR handoffs responsive.
    const timer=enquiryId ? (lookup(),undefined) : setTimeout(lookup,200);
    return()=>{current=false;clearTimeout(timer);};
  },[enquiryId,search,lookupRetry]);
  const requestedId=enquiryId||selected,customer=customers.find(item=>item.id===requestedId||item.requestedEnquiryId===requestedId);
  const selectedId=customer?.id||requestedId;
  const number=customerWhatsAppNumber(phone),savedNumber=customerWhatsAppNumber(customer?.phone||'');
  const mismatch=!create&&number&&savedNumber&&number!==savedNumber;
  const mismatchKey=mismatch?JSON.stringify([selectedId,number,savedNumber]):'';
  useEffect(()=>{setAcknowledgedMismatch('');},[selectedId,number,savedNumber]);
  const mismatchAccepted=!mismatch||acknowledgedMismatch===mismatchKey;
  const locked=Boolean(attempt.current);
  const identityReady=!loading&&!lookupError&&(create?canCreate&&name.trim().length>=2:Boolean(customer));
  const ready=!disabled&&(locked||Boolean(number&&identityReady&&mismatchAccepted));
  useEffect(()=>{onReadyChange?.(ready);},[ready,onReadyChange]);
  useEffect(()=>{onCustomerChange?.(identityReady ? create ? {customerName:name,createNew:true} : customer ? {enquiryId:customer.id,customerName:customer.customerName} : null : null);},[identityReady,create,name,customer?.id,customer?.customerName,onCustomerChange]);
  async function confirm(){
    if(saving||result||!ready)return;
    const request=attempt.current||{requestId:crypto.randomUUID(),...(create?{newCustomer:{name,...(customerEmail?{email:customerEmail}:{})}}:{enquiryId:selectedId}),...(vehicleId?{vehicleId}:{}),...(grantId?{grantId}:{}),phone,message,confirmed:true as const};
    attempt.current=request;onLock(true);setSaving(true);setError('');
    try{
      const saved=await customFetch<WhatsAppConfirmationResult>('/api/staff/phone-shares/confirm-whatsapp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
      onConfirmed(saved);
      void cache?.invalidateQueries();
    }catch(cause){setError((cause as {data?:{error?:string}})?.data?.error || 'The confirmation could not be saved. Retry this confirmation; do not send the WhatsApp message again.');}
    finally{setSaving(false);}
  }
  if(result)return <section className="phone-share-confirmation" role="status"><strong>WhatsApp sent — staff confirmed</strong><p>{result.preview?"Local preview only. No live customer history was changed.":"Saved in the customer’s enquiry history. Delivery has not been independently verified."}</p><a href={`/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(result.enquiryId)}`}>Open customer enquiry</a></section>;
  return <section className="phone-share-confirmation" aria-label="Record WhatsApp sent">
    <strong>{enquiryId || selected ? "Customer enquiry" : "Choose customer before sending"}</strong>
    {!enquiryId && selected && customer && !create ? <div className="phone-share-selected-customer"><span><strong>{customer.customerName}</strong>{customer.vehicleTitle && <small>{customer.vehicleTitle}</small>}</span><Button type="button" variant="ghost" disabled={locked} onClick={()=>setSelected('')}>Change customer</Button></div> : !enquiryId && <>
      <label>Find customer enquiry<Input value={search} disabled={locked} onChange={event=>{setSearch(event.target.value);setSelected('');setCreate(false);setError('');}} placeholder="Name, phone or email" /></label>
      <label>Save against enquiry<NativeSelect value={selected} disabled={locked||loading||create} onChange={event=>{setSelected(event.target.value);const customer=customers.find(item=>item.id===event.target.value);if(customer?.phone&&!phone.trim())onPhone(customer.phone);if(customer?.email)onEmail(customer.email);}}><option value="">Choose the customer’s enquiry</option>{customers.map(customer=><option key={customer.id} value={customer.id}>{customer.customerName}{customer.vehicleTitle?` — ${customer.vehicleTitle}`:''}</option>)}</NativeSelect></label>
      {canCreate && (!selected || create) && <label className="phone-share-create"><input type="checkbox" checked={create} disabled={locked||loading} onChange={event=>{setCreate(event.target.checked);setSelected('');}} />Create a new enquiry instead</label>}
      {create&&<label>Customer name<Input value={name} disabled={locked} onChange={event=>setName(event.target.value)} maxLength={200} /></label>}
    </>}
    {enquiryId&&<p>Save against {customer?.customerName||customerName||'this customer’s enquiry'}.</p>}
    {loading&&!locked&&<p role="status">Checking customer details…</p>}
    {lookupError&&!locked&&<div><p role="alert">{lookupError}</p><Button type="button" variant="outline" onClick={()=>setLookupRetry(value=>value+1)}>Retry customer lookup</Button></div>}
    {mismatch&&<div className="phone-share-recipient-warning" role="status">
      <p>The WhatsApp recipient is <strong>+{number}</strong>. {customer?.customerName}’s saved enquiry number is <strong>+{savedNumber}</strong>.</p>
      <label className="phone-share-create"><input type="checkbox" checked={mismatchAccepted} disabled={locked} onChange={event=>setAcknowledgedMismatch(event.target.checked?mismatchKey:'')} />I’ve checked +{number} is the right recipient, and will save this message in {customer?.customerName}’s enquiry history.</label>
    </div>}
    {children}
    <p>After sending, press “I’ve sent it” below. This saves the message shown above, the recipient number, your staff name and the time.</p>
    {error&&<p role="alert">{error}</p>}
    <Button type="button" disabled={saving||!ready} onClick={()=>void confirm()}>{saving?'Saving confirmation…':locked?'Retry saving confirmation':"I’ve sent it"}</Button>
  </section>;
}

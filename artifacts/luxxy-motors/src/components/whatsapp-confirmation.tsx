import { customerWhatsAppNumber } from "@/lib/customer-whatsapp";
import { useContext, useEffect, useState, type MutableRefObject } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

type Customer = {id:string;customerName:string;phone?:string;email?:string;vehicleTitle?:string};
export type WhatsAppConfirmationRequest = {requestId:string;enquiryId?:string;newCustomer?:{name:string;email?:string};vehicleId?:string;grantId?:string;phone:string;message:string;confirmed:true};
export type WhatsAppConfirmationResult = {enquiryId:string;confirmedAt:string;preview?:boolean};
export function WhatsAppConfirmation({enquiryId,customerName='',phone,message,grantId,vehicleId,attempt,result,onConfirmed,onLock,onPhone,onEmail}: {
  enquiryId?:string;customerName?:string;phone:string;message:string;grantId?:string;vehicleId?:string;
  attempt:MutableRefObject<WhatsAppConfirmationRequest|null>;result:WhatsAppConfirmationResult|null;
  onConfirmed:(value:WhatsAppConfirmationResult)=>void;onLock:(value:boolean)=>void;onPhone:(value:string)=>void;onEmail:(value:string)=>void;
}) {
  const cache=useContext(QueryClientContext);
  const [selected,setSelected]=useState(enquiryId||''),[search,setSearch]=useState(enquiryId?'':phone),[customers,setCustomers]=useState<Customer[]>([]);
  const [create,setCreate]=useState(false),[name,setName]=useState(customerName),[canCreate,setCanCreate]=useState(false),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
  useEffect(()=>{
    let current=true;
    const timer=setTimeout(()=>{
      setLoading(true);
      void customFetch<{enquiries:Customer[];canCreate?:boolean}>(`/api/staff/phone-shares/enquiries?${enquiryId?`id=${encodeURIComponent(enquiryId)}`:`q=${encodeURIComponent(search)}`}`)
        .then(data=>{if(!current)return;setCustomers(data?.enquiries||[]);setCanCreate(data?.canCreate===true);if(enquiryId&&!phone&&data?.enquiries?.[0]?.phone)onPhone(data.enquiries[0].phone);if(enquiryId&&data?.enquiries?.[0]?.email)onEmail(data.enquiries[0].email);})
        .catch(()=>{if(current)setError('Customer enquiries could not be checked. Retry by searching again.');})
        .finally(()=>{if(current)setLoading(false);});
    },200);
    return()=>{current=false;clearTimeout(timer);};
  },[enquiryId,search]);
  async function confirm(){
    if(saving||result)return;
    const request=attempt.current||{requestId:crypto.randomUUID(),...(create?{newCustomer:{name}}:{enquiryId:selected}),...(vehicleId?{vehicleId}:{}),...(grantId?{grantId}:{}),phone,message,confirmed:true as const};
    attempt.current=request;onLock(true);setSaving(true);setError('');
    try{
      const saved=await customFetch<WhatsAppConfirmationResult>('/api/staff/phone-shares/confirm-whatsapp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
      onConfirmed(saved);
      void cache?.invalidateQueries();
    }catch(cause){setError((cause as {data?:{error?:string}})?.data?.error || 'The confirmation could not be saved. Retry this confirmation; do not send the WhatsApp message again.');}
    finally{setSaving(false);}
  }
  if(result)return <section className="phone-share-confirmation" role="status"><strong>WhatsApp sent — staff confirmed</strong><p>{result.preview?"Local preview only. No live customer history was changed.":"Saved in the customer’s enquiry history. Delivery has not been independently verified."}</p><a href={`/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(result.enquiryId)}`}>Open customer enquiry</a></section>;
  const locked=Boolean(attempt.current);
  return <section className="phone-share-confirmation" aria-label="Record WhatsApp sent">
    <strong>After you’ve sent it</strong>
    {!enquiryId && <>
      <label>Find customer enquiry<Input value={search} disabled={locked} onChange={event=>{setSearch(event.target.value);setSelected('');setCreate(false);setError('');}} placeholder="Name, phone or email" /></label>
      <label>Save against enquiry<NativeSelect value={selected} disabled={locked||loading||create} onChange={event=>{setSelected(event.target.value);const customer=customers.find(item=>item.id===event.target.value);if(customer?.phone)onPhone(customer.phone);if(customer?.email)onEmail(customer.email);}}><option value="">Choose the customer’s enquiry</option>{customers.map(customer=><option key={customer.id} value={customer.id}>{customer.customerName}{customer.vehicleTitle?` — ${customer.vehicleTitle}`:''}</option>)}</NativeSelect></label>
      {canCreate && (!selected || create) && <label className="phone-share-create"><input type="checkbox" checked={create} disabled={locked} onChange={event=>{setCreate(event.target.checked);setSelected('');}} />Create a new enquiry instead</label>}
      {create&&<label>Customer name<Input value={name} disabled={locked} onChange={event=>setName(event.target.value)} maxLength={200} /></label>}
    </>}
    {enquiryId&&<p>Save against {customers.find(item=>item.id===enquiryId)?.customerName||customerName||'this customer’s enquiry'}.</p>}
    <p>Only confirm after pressing Send in WhatsApp. This records the message shown above, your staff name and the time.</p>
    {error&&<p role="alert">{error}</p>}
    <Button type="button" disabled={saving||!customerWhatsAppNumber(phone)||(!locked&&(create?name.trim().length<2:!selected))} onClick={()=>void confirm()}>{saving?'Saving confirmation…':locked?'Retry saving confirmation':"I’ve sent it"}</Button>
  </section>;
}

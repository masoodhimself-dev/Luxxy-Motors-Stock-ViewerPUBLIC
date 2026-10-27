import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import type { TestSession } from '@/pages/sales-demo';
import { TestEmailButton } from '@/components/portal/test-email';
import { TestCustomerBrowser } from '@/components/portal/test-customer-browser';
import { RealCustomerPreview } from '@/components/portal/real-customer-preview';
import { TestPhotoInput } from '@/components/portal/test-photo-input';
import type { EnquiryInput } from '@workspace/api-client-react';
import { useDealerSettings } from '@/lib/dealer-settings-context';

type TestEnquiry = {id:string; reference:string; vehicleId:string|null; vehicleTitle:string; customerName:string; phone:string; email:string; type:string; message:string; partExchange?:{registration:string;mileage:number;condition:string|null}|null; appointmentAt:string|null; appointmentStatus:string|null; saleId:string|null; revision:number};

function TestSlots({base,value,onChange,excludeId}:{base:string;value:string;onChange:(value:string)=>void;excludeId?:string}) {
  const [date,setDate]=useState('');
  const availability=useQuery({queryKey:['test-availability',base,date,excludeId],queryFn:({signal})=>customFetch<{slots:{startAt:string;label:string;available:boolean}[]}>(`${base}/availability?date=${encodeURIComponent(date)}${excludeId?`&excludeId=${encodeURIComponent(excludeId)}`:''}`,{signal}),enabled:Boolean(date),retry:false,staleTime:0});
  return <div className="grid gap-2"><label className="grid gap-1 text-sm font-medium">Test drive date<input type="date" required className="rounded border bg-background p-2" value={date} onChange={event=>{setDate(event.target.value);onChange('');}} /></label>
    {availability.isFetching && <p role="status">Checking times…</p>}
    {availability.isError && <p role="alert">Could not check times. <button type="button" className="underline" onClick={()=>void availability.refetch()}>Try again</button></p>}
    {date && availability.data && !availability.isFetching && <label className="grid gap-1 text-sm font-medium">Available time<select required className="rounded border bg-background p-2" value={value} onChange={event=>onChange(event.target.value)}><option value="">Choose a time</option>{availability.data.slots.filter(slot=>slot.available).map(slot=><option value={slot.startAt} key={slot.startAt}>{slot.label}</option>)}</select>{!availability.data.slots.some(slot=>slot.available) && <small>No times available on this date.</small>}</label>}
    <small className="text-muted-foreground">Times reflect current availability. Practice bookings do not reserve a live slot.</small>
  </div>;
}

export function EnquiryEmail({sessionId,enquiry}:{sessionId:string;enquiry:TestEnquiry}) {
  const [template,setTemplate] = useState('enquiry_acknowledgement');
  const [message,setMessage] = useState('');
  const [photos,setPhotos] = useState<string[]>([]);
  const [photosBusy,setPhotosBusy] = useState(false);
  const [invoice,setInvoice] = useState('');
  const prefix=`/api/sales-test/sessions/${encodeURIComponent(sessionId)}`;
  const history=useQuery({queryKey:['sales-test',sessionId,'email-history',enquiry.id],queryFn:({signal})=>customFetch<{messages:{id:string;to:string;subject:string;text:string;sentAt:string}[]}>(`${prefix}/email-history?enquiryId=${encodeURIComponent(enquiry.id)}`,{signal}),retry:false});
  const sale=useQuery({queryKey:['sales-test',sessionId,'sale-documents',enquiry.saleId],queryFn:({signal})=>customFetch<{sale:{documents:{id:string;type:string;number:string}[]}}>(`${prefix}/sale-workspace/${encodeURIComponent(enquiry.saleId!)}`,{signal}),enabled:template==='invoice_copy' && Boolean(enquiry.saleId),retry:false});
  const invoices=(sale.data?.sale?.documents??[]).filter(document=>document.type==='invoice');
  const canAttach=['vehicle_details','service_history','pre_accident_photos','enquiry_message'].includes(template);
  const needsPhoto=['service_history','pre_accident_photos'].includes(template);
  return <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-sm">Test email<select className="rounded border bg-background p-2" value={template} onChange={e=>{setPhotos([]);setPhotosBusy(false);setTemplate(e.target.value);}}>
    <option value="enquiry_acknowledgement">Enquiry acknowledgement</option><option value="dealer_notification">Dealer notification</option><option value="callback">Callback</option>{enquiry.vehicleId && <option value="vehicle_details">Vehicle details</option>}{enquiry.saleId && <option value="invoice_copy">Invoice copy</option>}{enquiry.vehicleId && <><option value="service_history">Service-book photos</option><option value="pre_accident_photos">Pre-accident photos</option></>}<option value="enquiry_message">Custom reply</option>
    {enquiry.appointmentAt && <><option value="appointment_details">Appointment details</option><option value="booking_request">Booking request</option><option value="booking_confirmation">Booking confirmation</option><option value="booking_change">Booking change</option><option value="booking_cancellation">Booking cancellation</option><option value="booking_reminder">Booking reminder</option></>}
  </select></label>{template==='enquiry_message' && <label className="grid flex-1 gap-1 text-sm">Message<textarea className="rounded border bg-background p-2" value={message} onChange={e=>setMessage(e.target.value)} /></label>}
  {template==='invoice_copy' && <label className="grid gap-1 text-sm">Test invoice<select className="rounded border bg-background p-2" value={invoice} onChange={e=>setInvoice(e.target.value)}><option value="">Choose an invoice</option>{invoices.map(document=><option key={document.id} value={document.id}>{document.number}</option>)}</select>{sale.isError && <small>Could not load test invoices.</small>}{!sale.isLoading && !invoices.length && <small>Create an invoice in the linked test sale first.</small>}</label>}
  {canAttach && <TestPhotoInput key={template} onChange={setPhotos} onBusyChange={setPhotosBusy}/>}
  {!photosBusy && (template!=='enquiry_message' || message.trim()) && (!needsPhoto || photos.length) && (template!=='invoice_copy'||invoice) ? <TestEmailButton sessionId={sessionId} enquiryId={enquiry.id} templateId={template} documentId={template==='invoice_copy'?invoice:undefined} message={template==='enquiry_message'?message:undefined} photos={canAttach?photos:undefined} onSent={()=>void history.refetch()}/> : <p className="text-sm">{photosBusy?'Preparing photos…':needsPhoto&&!photos.length?'Choose a photo to preview.':template==='invoice_copy'&&!invoice?'Choose a test invoice.':'Enter a message to preview.'}</p>}
  {history.isError && <p role="alert">Could not load test email history.</p>}{Boolean(history.data?.messages?.length) && <details className="w-full"><summary className="cursor-pointer text-sm">Sent test emails ({history.data!.messages.length})</summary>{history.data!.messages.map(item=><article className="mt-2 rounded border p-2 text-sm" key={item.id}><strong>{item.subject}</strong><p>Sent to {item.to} · {new Date(item.sentAt).toLocaleString('en-GB')}</p><p className="whitespace-pre-wrap">{item.text}</p></article>)}</details>}</div>;
}

/** All writes in this workspace use the isolated test-session API. */
export function TestEnquiries({session,onOpenSale}: {session:TestSession; onOpenSale?:(enquiry:{id:string;saleId:string|null;customerName:string;email:string;phone:string;partExchange?:TestEnquiry['partExchange']})=>void}) {
  const [type,setType] = useState('general');
  const [customerPageOpen,setCustomerPageOpen] = useState(false);
  const [realPageOpen,setRealPageOpen] = useState(false);
  const [message,setMessage] = useState('');
  const [appointment,setAppointment] = useState('');
  const [bookingFor,setBookingFor] = useState<string|null>(null);
  const [bookingTime,setBookingTime] = useState('');
  const requestId = useRef<string|null>(null);
  const websiteRequest = useRef<{key:string;id:string}|null>(null);
  const appointmentRequest = useRef<{key:string;id:string}|null>(null);
  const client = useQueryClient();
  const base = `/api/sales-test/sessions/${encodeURIComponent(session.sessionId)}/enquiries`;
  const key = ['sales-test',session.sessionId,'practice-enquiries'];
  const list = useQuery({queryKey:key, queryFn:({signal})=>customFetch<{enquiries:TestEnquiry[]}>(base,{signal}), retry:false});
  const testSettings=useQuery({queryKey:['sales-test',session.sessionId,'settings'],queryFn:({signal})=>customFetch<{config:ReturnType<typeof useDealerSettings>['settings']}>(`/api/sales-test/sessions/${encodeURIComponent(session.sessionId)}/settings`,{signal}),enabled:customerPageOpen||realPageOpen,retry:false});
  const submitWebsiteEnquiry=async(input:EnquiryInput)=>{
    const payload={type:input.type,vehicleId:input.vehicleId,message:input.message,contact:{name:input.customerName,email:input.email??'',phone:input.phone??''},partExchange:input.partExchange??null,...(input.type==='viewing'?{appointmentAt:input.appointmentAt}:{})};
    const attemptKey=JSON.stringify(payload);
    if(websiteRequest.current?.key!==attemptKey)websiteRequest.current={key:attemptKey,id:crypto.randomUUID()};
    const result=await customFetch<{enquiry:TestEnquiry}>(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId:websiteRequest.current.id})});
    websiteRequest.current=null;
    await client.invalidateQueries({queryKey:key});
    return {appointmentStatus:result.enquiry.appointmentStatus};
  };
  const create = useMutation({mutationFn:()=>customFetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:requestId.current ??= crypto.randomUUID(),type,message,...(type==='viewing'?{appointmentAt:appointment}: {})})}), onSuccess:()=>{requestId.current=null;setMessage('');setAppointment('');void client.invalidateQueries({queryKey:key});void client.invalidateQueries({queryKey:['test-availability',base]});}});
  const changeAppointment = useMutation({mutationFn:({enquiry,action}:{enquiry:TestEnquiry;action:'book'|'cancel'|'confirm'})=>{const attemptKey=`${enquiry.id}:${enquiry.revision}:${action}:${action==='book'?bookingTime:''}`;if(appointmentRequest.current?.key!==attemptKey)appointmentRequest.current={key:attemptKey,id:crypto.randomUUID()};return customFetch(`${base}/${encodeURIComponent(enquiry.id)}/appointment`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:appointmentRequest.current.id,expectedRevision:enquiry.revision,action,...(action==='book'?{appointmentAt:bookingTime}: {})})});},onSuccess:()=>{appointmentRequest.current=null;setBookingFor(null);setBookingTime('');void client.invalidateQueries({queryKey:key});void client.invalidateQueries({queryKey:['test-availability',base]});}});
  return <section className="mx-auto max-w-4xl space-y-5" aria-label="Test enquiries">
    <header><h2 className="text-xl font-semibold">Inbox</h2><p className="text-sm text-muted-foreground">Create a practice website enquiry for {session.customer.name} about {session.vehicle.title}.</p></header>
    <details className="rounded border bg-card p-4" onToggle={event=>setCustomerPageOpen(event.currentTarget.open)}><summary className="cursor-pointer font-semibold">Try customer pages</summary>{customerPageOpen && (testSettings.data?.config ? <TestCustomerBrowser session={session} config={testSettings.data.config} submit={submitWebsiteEnquiry}/> : testSettings.isError ? <p role="alert">Could not load test settings. <button type="button" onClick={()=>void testSettings.refetch()}>Retry</button></p> : <p role="status">Loading test page…</p>)}</details>
    <details className="rounded border bg-card p-4" onToggle={event=>setRealPageOpen(event.currentTarget.open)}><summary className="cursor-pointer font-semibold">Try actual customer website (preview)</summary>{realPageOpen && (testSettings.data?.config ? <section aria-label="Actual customer website test preview"><RealCustomerPreview session={session} config={testSettings.data.config} submit={submitWebsiteEnquiry}/></section> : testSettings.isError ? <p role="alert">Could not load test settings. <button type="button" onClick={()=>void testSettings.refetch()}>Retry</button></p> : <p role="status">Loading test page…</p>)}</details>
    <form className="grid gap-3 rounded border bg-card p-4" onSubmit={e=>{e.preventDefault(); if(message.trim() && (type!=='viewing' || appointment)) create.mutate();}}>
      <label className="grid gap-1 text-sm font-medium">Enquiry type<select className="rounded border bg-background p-2" value={type} onChange={e=>{requestId.current=null;setType(e.target.value);}}><option value="general">General enquiry</option><option value="viewing">Test drive</option><option value="part_exchange">Part exchange</option></select></label>
      <label className="grid gap-1 text-sm font-medium">Message<textarea required rows={3} className="rounded border bg-background p-2" value={message} onChange={e=>{requestId.current=null;setMessage(e.target.value);}}/></label>
      {type==='viewing' && <TestSlots base={base} value={appointment} onChange={v=>{requestId.current=null;setAppointment(v);}}/>}
      {create.isError && <p role="alert">{create.error instanceof Error ? create.error.message : 'Could not create the enquiry.'}</p>}
      <Button type="submit" disabled={create.isPending}>{create.isPending?'Creating…':'Create practice enquiry'}</Button>
    </form>
    {list.isError && <p role="alert">Could not load test enquiries. <Button type="button" variant="outline" onClick={()=>void list.refetch()}>Retry</Button></p>}
    {list.data?.enquiries.map(enquiry=><article key={enquiry.id} className="space-y-3 rounded border bg-card p-4"><div><strong>{enquiry.customerName}</strong><p className="text-sm text-muted-foreground">{enquiry.type.replace('_',' ')}{enquiry.vehicleTitle ? ` · ${enquiry.vehicleTitle}` : ''}</p></div><p className="whitespace-pre-wrap">{enquiry.message}</p>
      {enquiry.partExchange && <p>Part exchange: {enquiry.partExchange.registration} · {enquiry.partExchange.mileage.toLocaleString('en-GB')} miles{enquiry.partExchange.condition ? ` · ${enquiry.partExchange.condition}` : ''}</p>}
      {enquiry.appointmentAt && <p>Test drive: {new Date(enquiry.appointmentAt).toLocaleString('en-GB')} · {enquiry.appointmentStatus}</p>}
      <div className="flex flex-wrap gap-2">{enquiry.vehicleId && <Button type="button" variant="outline" onClick={()=>{appointmentRequest.current=null;setBookingFor(enquiry.id);}}>Book or change test drive</Button>}
      {enquiry.appointmentStatus==='pending' && <Button type="button" variant="outline" disabled={changeAppointment.isPending} onClick={()=>changeAppointment.mutate({enquiry,action:'confirm'})}>Confirm test drive</Button>}
      {['confirmed','pending'].includes(enquiry.appointmentStatus??'') && <Button type="button" variant="outline" disabled={changeAppointment.isPending} onClick={()=>changeAppointment.mutate({enquiry,action:'cancel'})}>Cancel test drive</Button>}</div>
      {onOpenSale && enquiry.vehicleId===session.vehicle.id && <Button type="button" variant="outline" onClick={()=>onOpenSale({id:enquiry.id,saleId:enquiry.saleId ?? null,customerName:enquiry.customerName,email:enquiry.email,phone:enquiry.phone,partExchange:enquiry.partExchange??null})}>{enquiry.saleId?'Open sale':'Start sale'}</Button>}{onOpenSale && enquiry.vehicleId!==session.vehicle.id && <p className="text-sm text-muted-foreground">{enquiry.vehicleId ? 'To practise a sale for this car, start a test session with it selected.' : 'Choose a car in a new test session before practising a sale or test drive.'}</p>}
      {bookingFor===enquiry.id && <div className="grid gap-2"><TestSlots base={base} excludeId={enquiry.id} value={bookingTime} onChange={v=>{appointmentRequest.current=null;setBookingTime(v);}}/><Button type="button" disabled={!bookingTime || changeAppointment.isPending} onClick={()=>changeAppointment.mutate({enquiry,action:'book'})}>Save test drive</Button></div>}
      {changeAppointment.isError && <p role="alert">{changeAppointment.error instanceof Error?changeAppointment.error.message:'Could not update the booking.'}</p>}
      <EnquiryEmail sessionId={session.sessionId} enquiry={enquiry}/>
    </article>)}
  </section>;
}

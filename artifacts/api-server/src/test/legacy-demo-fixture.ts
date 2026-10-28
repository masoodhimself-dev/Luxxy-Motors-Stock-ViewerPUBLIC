import { randomUUID } from 'node:crypto';
import { createSaleWorkspace, changeSaleWorkspace, currentInvoiceSettings, invoiceBranding, saleWorkspaceBranding, type SaleWorkspaceContext } from '@workspace/vehicle-meta';
import type { SaleWorkspaceReadClient } from '../lib/sale-workspace-store';

/** Historical fixtures for isolated conversion regression tests only. Never imported by production code. */
export async function seedLegacyDemoFixture(client: SaleWorkspaceReadClient, dealerId: string, config: any) {
  const vehicles = (await client.query('SELECT id, title, plate, registration, source_price FROM vehicles WHERE dealer_id=$1 ORDER BY id LIMIT 3', [dealerId])).rows;
  const now = new Date();
  for (let i=0; i<3; i++) {
    const vehicle = vehicles[i % Math.max(vehicles.length,1)];
    const at = new Date(now); at.setUTCDate(at.getUTCDate()+i+1); at.setUTCHours(11+i,0,0,0);
    await client.query(`INSERT INTO enquiries (id,dealer_id,reference,vehicle_id,vehicle_title,type,customer_name,email,message,source,appointment_at,appointment_status,appointment_duration_minutes,follow_up_at,follow_up_note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'demo',$10,$11,$12,$13,$14)`, [randomUUID(),dealerId,`DEMO-${randomUUID().slice(0,8)}`,vehicle?.id ?? null,vehicle?.title ?? 'Example vehicle',i===0?'viewing':'general',['Alex Morgan (fictional)','Jamie Taylor (fictional)','Sam Ellis (fictional)'][i],`demo${i+1}@example.invalid`,'Fictional demonstration enquiry. No real customer.',i===0?at.toISOString():null,i===0?'confirmed':null,i===0?30:null,i===1?at.toISOString():null,i===1?'Sample callback: discuss this car.':null]);
  }
  for (let i=0; i<2; i++) {
    const v=vehicles[i];
    const price = Number(v?.source_price) > 0 ? Number(v!.source_price).toFixed(2) : '12995.00';
    let number=0;
    const branding=invoiceBranding(saleWorkspaceBranding(config),currentInvoiceSettings(config?.invoiceSettings)); branding.identity.name += ' · SAMPLE / DEMO';
    const context: SaleWorkspaceContext={now:now.toISOString(),actor:'Demo setup (fictional)',nextId:randomUUID,nextNumber:() => `SAMPLE-${i+1}-${++number}`,branding,paperwork:{saleTerms:'SAMPLE ONLY — fictional demonstration. Not a contract of sale.',reservationTerms:'SAMPLE ONLY — no money received.'},vehicle:v?{id:v.id,title:v.title,registration:v.plate||v.registration}:undefined};
    let sale=createSaleWorkspace({requestId:randomUUID(),draft:{id:'',customer:['Alex Morgan (fictional)','Jamie Taylor (fictional)'][i],email:`demo${i+1}@example.invalid`,phone:'',address:'Fictional demonstration address',vehicleId:v?.id ?? '',vehicle:v?.title ?? 'Example vehicle',registration:v?.plate||v?.registration||'',price,partExchange:false,pxRegistration:'',pxDescription:'',pxValue:'0',deposit:'0',paymentMethod:'Bank transfer',notes:'SAMPLE — no real sale or payment.',collection:'',preparation:false,documents:false,handover:false}},context,`SAMPLE-SALE-${i+1}`).sale;
    const deposit=Math.min(200,Number(price));
    const payment=(amount:number,kind:'deposit'|'part-payment'|'final-payment',date:string)=>({action:'invoice-payment' as const,payment:{amount:amount.toFixed(2),method:'Bank transfer',date,reference:'FICTIONAL-PAYMENT',kind,status:'confirmed' as const}});
    const commands=[payment(deposit,'deposit',new Date(now.getTime()-2*86400000).toISOString().slice(0,10))];
    if(i===1){const interim=Math.round((Number(price)-deposit)/2*100)/100;commands.push(payment(interim,'part-payment',new Date(now.getTime()-86400000).toISOString().slice(0,10)),payment(Number(price)-deposit-interim,'final-payment',now.toISOString().slice(0,10)));}
    for(const command of commands) sale=changeSaleWorkspace(sale,command,{requestId:randomUUID(),expectedRevision:sale.revision},context).sale;
    sale=changeSaleWorkspace(sale,{action:'issue-invoice',kind:i===0?'deposit':'full',acknowledge:true},{requestId:randomUUID(),expectedRevision:sale.revision},context).sale;
    if(i===0 && v){
      sale=changeSaleWorkspace(sale,{action:'lifecycle',status:'reserved'},{requestId:randomUUID(),expectedRevision:sale.revision},context).sale;
      await client.query("UPDATE vehicles SET inventory_status='reserved' WHERE dealer_id=$1 AND id=$2",[dealerId,v.id]);
      const leadId=randomUUID();
      await client.query("INSERT INTO leads (id,dealer_id,vehicle_id,vehicle_title,source,stage,customer_name,email,summary,deposit_pence,deposit_method,deposit_reference,deposit_taken_at) VALUES ($1,$2,$3,$4,'phone','reserved','Alex Morgan (fictional)','demo1@example.invalid','Fictional demonstration reservation. No real funds.', $5,'bank_transfer','SAMPLE',now())",[leadId,dealerId,v.id,v.title,Math.round(deposit*100)]);
      await client.query("INSERT INTO lead_events (lead_id,type,actor_type,body) VALUES ($1,'note_added','system','SAMPLE — fictional reservation for demonstration only.')",[leadId]);
    }
    await client.query('INSERT INTO sale_workspace (id,dealer_id,reference,revision,state) VALUES ($1,$2,$3,$4,$5::jsonb)',[sale.id,dealerId,sale.reference,sale.revision,JSON.stringify(sale)]);
  }
}

import { drawInvoiceRegistrationPlate } from './registration-plate-pdf.ts';
import { formatRegistrationPlate } from './registration.ts';
import { jsPDF } from 'jspdf';
import qrcode from 'qrcode-generator';
import { invoicePalette } from './invoice-palette.ts';
import { invoiceTextLimits, SaleWorkspaceError, saleWorkspacePence, type SaleWorkspaceDocument } from './sale-workspace.ts';

/** A single A4 sheet. Content is measured, never clipped, dropped or silently shrunk. */
export function compactInvoicePdf(document: SaleWorkspaceDocument, options: { fileId?: string; draft?: boolean } = {}): Uint8Array {
  const { draft, vehicle, branding, totals } = document.snapshot;
  const design = branding.invoiceSettings!;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: false });
  pdf.setCreationDate(new Date(document.issuedAt));
  pdf.setFileId(options.fileId ?? document.id.replace(/[^a-f0-9]/gi, '').padEnd(32, '0').slice(0, 32));
  pdf.setProperties({ title: `${document.title} ${document.number}`, author: branding.identity.name });
  const palette = invoicePalette(branding.presentation?.linkColour);
  const left = 16, right = 194, width = right-left, bodyBottom = 251;
  const signature = design.style === 'branded' && !design.inkSaving;
  const accent = design.inkSaving ? '#27343D' : palette.strong;
  const ink = '#202E36', muted = '#58656E', rule = '#DCE2E6';
  const clean = (v: unknown) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g,' ').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').trim();
  const supplied = (v: unknown) => /^(unknown|n\/a|not supplied|not provided|your dealership|your address|enter .+|\[.+\])$/i.test(clean(v)) ? '' : clean(v);
  const money = (n: number) => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(n/100);
  const date = (v: string) => { const d = new Date(v.length===10 ? v+'T12:00:00Z' : v); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',year:'numeric'}) : clean(v); };
  const rgb = (hex: string) => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  function font(size=9, bold=false, colour=ink) { pdf.setFont('helvetica',bold?'bold':'normal'); pdf.setFontSize(size); pdf.setTextColor(...rgb(colour) as [number,number,number]); }
  function text(value: string | string[], x: number, y: number, size=9, bold=false, colour=ink, align: 'left'|'right'='left') { font(size,bold,colour); pdf.text(value,x,y,{align,lineHeightFactor:1.15}); }
  function rows(value: unknown, w=width, size=9, bold=false): string[] { font(size,bold); return pdf.splitTextToSize(clean(value),w); }
  function line(y: number, start=left, end=right, colour=rule, weight=.18) { pdf.setDrawColor(...rgb(colour) as [number,number,number]); pdf.setLineWidth(weight); pdf.line(start,y,end,y); }
  function heading(value: string, baseline: number) {
    text(value,left,baseline,9.4,true,signature?accent:ink);
  }
  function fit(end: number, section: string) { if(end>bodyBottom) throw new SaleWorkspaceError(`This invoice exceeds one A4 page at ${section}. Shorten optional wording or long descriptions and try again. Keep all confirmed payments; no invoice has been issued.`); }
  const wording = { footer: clean(design.footer), paymentInstructions: clean(design.paymentInstructions), saleTerms: clean(document.content) };
  for(const [key,value] of Object.entries(wording)) if(value.length>invoiceTextLimits[key as keyof typeof invoiceTextLimits]) throw new SaleWorkspaceError(`Shorten ${key.replace(/([A-Z])/g,' $1').toLowerCase()} to ${invoiceTextLimits[key as keyof typeof invoiceTextLimits]} characters in invoice settings before issuing this A4 invoice.`);

  const name = supplied(branding.identity.name) || supplied(branding.legal.companyName);
  if(!name) throw new SaleWorkspaceError('Add the dealership name in settings before creating an invoice.');
  const title = document.invoiceKind==='deposit' ? 'Deposit invoice' : 'Sales invoice';
  let logo: { data:string;format:string;w:number;h:number } | undefined;
  if(design.showLogo && /^data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(branding.identity.logoAsset) && branding.identity.logoAsset.length<1_500_000) {
    try { const p=pdf.getImageProperties(branding.identity.logoAsset),maxW=design.logoSize==='small'?19:design.logoSize==='large'?32:25; const h=Math.min(8,maxW*p.height/p.width);logo={data:branding.identity.logoAsset,format:p.fileType,w:h*p.width/p.height,h}; } catch { /* Wordmark fallback preserves the dealer identity. */ }
  }
  const logoSpace=logo?logo.w+5:0;
  const names = rows(name,98-logoSpace,15,true), titles = rows(title,67,14,false);
  let y = 13;
  const headerHeight = Math.max(names.length*6,titles.length*6)+8;
  fit(y+headerHeight,'dealership heading');
  line(y,left,right,signature ? accent : ink,signature ? .65 : .3);
  if(logo) pdf.addImage(logo.data,logo.format,left,y+3,logo.w,logo.h);
  text(names,left+logoSpace,y+8,15,true,signature?accent:ink);
  text(titles,right,y+8,14,false,ink,'right');
  y+=headerHeight+4;
  const info = [
    [branding.address.street,branding.address.city,branding.address.region,branding.address.postcode].map(supplied).filter(Boolean).join(', '),
    [branding.contact.phone,branding.contact.email].map(supplied).filter(Boolean).join('  |  '),
  ].filter(Boolean).flatMap(v=>rows(v,106,8.1));
  fit(y+info.length*3.4,'dealership contact details');
  if(info.length) text(info,left,y,8.1,false,muted);
  const refs = rows(document.number,63,9.5,true);
  text(refs,right,y,9.5,true,accent,'right');
  text(date(document.issuedAt),right,y+refs.length*4,8.5,false,muted,'right');
  y+=Math.max(info.length*3.4,refs.length*4+4)+3;
  if(options.draft) { text('Draft - not issued',right,y,8,false,muted,'right'); y+=4; }
  line(y); y+=6;

  text('Billed to',left,y,8.2,false,muted); y+=4.3;
  const customers = [...rows(draft.customer,width,10,true), ...rows(draft.address,width,9)].filter(Boolean);
  fit(y+customers.length*3.8,'customer details');
  text(customers,left,y,9.5); y+=customers.length*3.8+5;

  const facts: Array<[string,unknown]> = [
    ['Year',vehicle?.year],['Mileage',typeof vehicle?.mileage==='number'?`${vehicle.mileage.toLocaleString('en-GB')} miles`:''],
    ['Fuel',vehicle?.fuel],['Gearbox',vehicle?.transmission],['Colour',vehicle?.colour],['Engine',vehicle?.engineSize],
    ['Previous keepers',vehicle?.owners],['Service history',vehicle?.serviceHistory],['Body type',vehicle?.bodyType],
    ['Emissions standard',vehicle?.emissionClass],['Doors / seats',[vehicle?.doors?`${vehicle.doors} doors`:'',vehicle?.seats?`${vehicle.seats} seats`:''].filter(Boolean).join(' / ')],
    ['Write-off category',vehicle?.writeOffCategory],
  ].filter(([,v])=>Boolean(supplied(v))) as Array<[string,unknown]>;
  const titleRows=rows(draft.vehicle || vehicle?.title || '',128,12,true);
  const plateRows=draft.registration?rows(`Registration  ${draft.registration}`,128,9.5,true):[];
  const plateValue=formatRegistrationPlate(draft.registration);
  const vehicleHeader=Math.max(27,12+titleRows.length*5+(plateValue?8:plateRows.length*4));
  const factWidth=(width-12)/4;
  const factHeights=Array.from({length:Math.ceil(facts.length/4)},(_,r)=>Math.max(10,...facts.slice(r*4,r*4+4).map(([,v])=>5+rows(v,factWidth-4,8.8,true).length*3.6)));
  const vehicleHeight=vehicleHeader+factHeights.reduce((a,b)=>a+b,0)+3;
  fit(y+vehicleHeight+4,'vehicle details');
  line(y);
  heading('Vehicle details',y+5);
  text(titleRows,left,y+11,12,true);
  if(plateRows.length) {
    const baseline=y+12+titleRows.length*5;
    if(plateValue) {text('Registration',left,baseline,8,false,muted);drawInvoiceRegistrationPlate(pdf,draft.registration,left+25,baseline-4.8);}
    else text(plateRows,left,baseline,9.5,false);
  }
  if(vehicle?.photoDataUrl) { try { const img=pdf.getImageProperties(vehicle.photoDataUrl); const w=Math.min(34,22*img.width/img.height),h=w*img.height/img.width; pdf.addImage(vehicle.photoDataUrl,img.fileType,right-38+(34-w)/2,y+3,w,h); } catch { /* Missing photos are omitted. */ } }
  let fy=y+vehicleHeader;
  facts.forEach(([label,value],i)=> { const x=left+(i%4)*factWidth; text(label,x,fy,7.8,false,muted); text(rows(value,factWidth-4,8.8,false),x,fy+4,8.8,false); if(i%4===3||i===facts.length-1) fy+=factHeights[Math.floor(i/4)]; });
  y+=vehicleHeight+2;
  line(y);y+=6;

  function amountRow(label: string, amount: number, bold=false) {
    const r=rows(label,width-32,9,bold), h=Math.max(4.7,r.length*3.6);
    fit(y+h,'price breakdown'); text(r,left,y,9,bold); text(money(amount),right,y,9.5,bold,ink,'right'); y+=h;
  }
  heading('Price breakdown',y); y+=5;
  amountRow('Vehicle price',totals.price);
  for(const a of draft.adjustments??[]) amountRow(a.description,saleWorkspacePence(a.amount)*(a.kind==='discount'?-1:1));
  for(const e of draft.exchanges??(draft.partExchange?[{registration:draft.pxRegistration,description:draft.pxDescription,value:draft.pxValue}]:[])) amountRow(`Part exchange - ${e.registration}${e.description?' - '+e.description:''}`,-saleWorkspacePence(e.value));
  line(y); y+=6;

  heading('Payments received',y); y+=5;
  text('Date',left,y+2,7.8,false,muted);
  text('Payment / reference',left+32,y+2,7.8,false,muted);
  text('Method',left+107,y+2,7.8,false,muted);
  text('Amount',right,y+2,7.8,false,muted,'right');
  line(y+4,left,right,signature ? accent : rule,signature ? .25 : .18); y+=8;
  const confirmed=document.snapshot.payments.filter(p=>p.status==='confirmed');
  if(!confirmed.length) { fit(y+5,'payment history'); text('No payments received at the invoice date.',left+2,y,8.8,false,muted); y+=5; }
  const kindLabels: Record<string,string>={'deposit':'Deposit','part-payment':'Interim payment','final-payment':'Final payment','refund':'Refund','reversal':'Reversal','refund-correction':'Refund correction'};
  for(const p of confirmed) {
    const label=kindLabels[p.kind]??p.kind;
    const desc=rows(label+(p.reference?' / '+p.reference:''),71,8.4);
    const method=rows(p.method,37,8.4);
    const h=Math.max(4.1,Math.max(desc.length,method.length)*3.4+.7);
    fit(y+h,'payment history');
    text(date(p.date),left,y,8.4); text(desc,left+32,y,8.4); text(method,left+107,y,8.4);
    text(money(p.signedAmountPence),right,y,8.8,false,ink,'right'); y+=h;
  }
  line(y); y+=5;
  fit(y+18,'financial summary');
  heading('Balance summary',y);
  const summaryLeft=right-77, amountWidth=34;
  const paidInFull=document.balanceAtIssue===0&&totals.totalDue>0&&totals.confirmedPaid>=totals.totalDue;
  const values=[['Sale total',totals.totalDue],['Payments received',totals.confirmedPaid],[paidInFull?'Paid in full':document.balanceAtIssue<0?'Customer credit':'Balance remaining',Math.abs(document.balanceAtIssue)]] as const;
  values.forEach(([label,amount],i)=>{
    const baseline=y+i*5.2, value=money(amount), preferred=i===2?10.5:9.4;
    font(preferred,i===2);const size=Math.min(preferred,preferred*amountWidth/Math.max(amountWidth,pdf.getTextWidth(value)));
    if(size<8.8) throw new SaleWorkspaceError('The amount is too long for the A4 invoice. Check the recorded sale amounts.');
    if(i===2) line(baseline-3.3,summaryLeft,right,signature?accent:rule,.25);
    text(label,summaryLeft,baseline,i===2?9:8.5,i===2,ink);text(value,right,baseline,size,i===2,ink,'right');
  });
  y+=18;
  if(totals.pending>0) { const r=rows(`Awaiting confirmation: ${money(totals.pending)}. Not deducted from the balance.`,width,8.3);fit(y+r.length*3.4+2,'pending payment note');text(r,left,y,8.3,false,muted);y+=r.length*3.4+2; }
  for(const [label,value] of [['Terms',wording.saleTerms],['Payment instructions',wording.paymentInstructions],['',wording.footer]]) {
    if(!value) continue;
    // Blank lines cannot create unbounded vertical space inside the character allowance.
    const r=value.split(/\r?\n/).filter(v=>v.trim()).flatMap(v=>rows(v,width,8.3));
    fit(y+(label?4:0)+r.length*3.4+2,label||'footer wording');
    if(label) { text(label,left,y,8.4,true); y+=4; }
    text(r,left,y,8.3,false,muted); y+=r.length*3.4+2;
  }

  // Fixed footer and quiet zone remain clear of all invoice content.
  line(257);
  const legal=[supplied(branding.legal.companyName),branding.legal.companyNumber?`Company ${branding.legal.companyNumber}`:'',branding.legal.vatNumber?`VAT registration ${branding.legal.vatNumber}`:''].filter(Boolean).join(' | ');
  const footerRows=rows([name,document.number,legal].filter(Boolean).join('\n'),145,7.8);
  if(footerRows.length>7) throw new SaleWorkspaceError('Shorten the dealership legal and contact details before issuing this A4 invoice. No invoice has been issued.');
  text(footerRows,left,263,7.8,false,muted);
  const url=document.verification?.url;
  if(url) {
    if(!/^https?:\/\/[a-z0-9.:[\]-]+\/verify-invoice\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9]{64}$/i.test(url)||url.length>700) throw new SaleWorkspaceError('The invoice verification address is invalid.');
    const qr=qrcode(0,'M'); qr.addData(url,'Byte'); qr.make();
    const modules=qr.getModuleCount(), quiet=4, size=24, cell=size/(modules+quiet*2), x=right-size, top=261;
    pdf.setFillColor(255,255,255);pdf.rect(x,top,size,size,'F');
    pdf.setFillColor(0,0,0);
    for(let r=0;r<modules;r++) for(let c=0;c<modules;c++) if(qr.isDark(r,c)) pdf.rect(x+(c+quiet)*cell,top+(r+quiet)*cell,cell,cell,'F');
    pdf.link(x,top,size,size,{url});
    text('Verify invoice',right,289,7.8,false,muted,'right');
  } else if(options.draft) text('Verification QR added on issue',right,267,7.5,false,muted,'right');
  return new Uint8Array(pdf.output('arraybuffer'));
}
